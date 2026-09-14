-- Live-link equipment-class PM templates to per-asset schedules/checklist items.
--
-- Previous behaviour (see stamp_pm_template_on_asset, 20260910120000): a
-- template's title/interval/checklist items were copied ("stamped") onto a
-- new asset's recurring_schedules/checklist_items row ONLY at asset-creation
-- time. Editing the template afterwards never touched existing assets --
-- deliberate at the time, to steer clear of the sync trouble this project
-- hit with its old Google Apps Script Template+Asset Matrix system.
-- Revisited: the GAS trouble was GAS being awkward to build sync logic in,
-- not a flaw in live-linking itself -- so this migration makes the link
-- live in Postgres via triggers, carrying over two safeguards from that
-- earlier discussion:
--
--   1. Per-asset customization stays possible. Any checklist_items row NOT
--      created from a template item (template_item_id IS NULL) is a
--      one-off/asset-specific task and is NEVER touched by propagation.
--   2. Template item deletion never hard-deletes linked checklist_items --
--      it soft-deletes them (active = false), so historical
--      wo_checklist_results (which references checklist_items.id) never
--      loses its target row.
--
-- New columns:
--   recurring_schedules.pm_template_id  -> equipment_type_pm_templates(id)
--     NULL means "not live-linked" -- either a legacy schedule that never
--     matched a template during backfill, or one created via the ad-hoc
--     "same PM title across a class" bulk-create flow in schedules.js's
--     createSchedule(), which still does NOT go through
--     equipment_type_pm_templates and remains standalone/unlinked by design.
--   checklist_items.template_item_id -> equipment_type_pm_template_items(id)
--     NULL means "asset-specific task, not sourced from any template".
--
-- Propagation rules (all via SECURITY DEFINER triggers with search_path
-- pinned, matching this project's existing trigger convention):
--   - New template item      -> insert into checklist_items for every
--                                schedule linked to that template.
--   - Edited template item   -> update description/item_type/unit/
--                                sort_order on every linked checklist_items
--                                row.
--   - Deleted template item  -> soft-delete (active=false) every linked
--                                checklist_items row.
--   - Edited template itself
--     (title/interval_days/
--     reminder_days_before)  -> update those same fields on every linked
--                                recurring_schedules row. next_due_at is
--                                DELIBERATELY left untouched by an
--                                interval_days change -- recalculating a
--                                live due date as a side effect of a
--                                template edit is a separate, riskier
--                                decision; raise it explicitly if wanted.
--
-- stamp_pm_template_on_asset() (the existing new-asset trigger) is updated
-- to set both new FK columns at creation time, so newly created assets are
-- linked from the start.
--
-- Backfill: existing schedules/checklist_items are matched to a template by
-- (equipment class, title, interval_days) for schedules, then (that
-- schedule's template, description/item_type/unit, case-insensitive and
-- trimmed) for checklist items, and linked retroactively. Anything that
-- doesn't find a confident match is left NULL/unlinked -- ambiguous
-- auto-linking is worse than no linking, and can be linked by hand later.

BEGIN;

-- 1. New columns --------------------------------------------------------

ALTER TABLE public.recurring_schedules
  ADD COLUMN IF NOT EXISTS pm_template_id bigint REFERENCES public.equipment_type_pm_templates(id);

ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS template_item_id bigint REFERENCES public.equipment_type_pm_template_items(id);

CREATE INDEX IF NOT EXISTS idx_recurring_schedules_pm_template_id
  ON public.recurring_schedules(pm_template_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_template_item_id
  ON public.checklist_items(template_item_id);

-- 2. Backfill existing rows ----------------------------------------------

-- Link schedules to a template by (equipment class, title, interval_days).
UPDATE public.recurring_schedules rs
SET pm_template_id = t.id
FROM public.assets a
JOIN public.equipment_type_pm_templates t
  ON t.equipment_type_id = a.equipment_type_id
WHERE rs.asset_id = a.id
  AND rs.pm_template_id IS NULL
  AND rs.title = t.title
  AND rs.interval_days = t.interval_days;

-- Link checklist items to a template item, only within schedules just
-- linked above, matched by normalized description/item_type/unit.
UPDATE public.checklist_items ci
SET template_item_id = ti.id
FROM public.recurring_schedules rs
JOIN public.equipment_type_pm_template_items ti
  ON ti.template_id = rs.pm_template_id
WHERE ci.schedule_id = rs.id
  AND ci.template_item_id IS NULL
  AND lower(trim(ci.description)) = lower(trim(ti.description))
  AND ci.item_type = ti.item_type
  AND coalesce(lower(trim(ci.unit)), '') = coalesce(lower(trim(ti.unit)), '');

-- 3. Update the asset-creation stamp trigger to set the new FKs ----------

CREATE OR REPLACE FUNCTION public.stamp_pm_template_on_asset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_template public.equipment_type_pm_templates%ROWTYPE;
  v_schedule_id bigint;
BEGIN
  IF NEW.equipment_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_template IN
    SELECT *
    FROM public.equipment_type_pm_templates
    WHERE equipment_type_id = NEW.equipment_type_id
  LOOP
    INSERT INTO public.recurring_schedules (
      asset_id, title, interval_days, next_due_at, reminder_days_before, pm_template_id
    ) VALUES (
      NEW.id, v_template.title, v_template.interval_days,
      NEW.created_at::date + v_template.interval_days,
      v_template.reminder_days_before, v_template.id
    )
    RETURNING id INTO v_schedule_id;

    INSERT INTO public.checklist_items (
      schedule_id, description, item_type, unit, sort_order, template_item_id
    )
    SELECT
      v_schedule_id, description, item_type, unit, sort_order, id
    FROM public.equipment_type_pm_template_items
    WHERE template_id = v_template.id;
  END LOOP;

  RETURN NEW;
END;
$$;

-- 4. Propagation trigger for template ITEM insert/update/delete ---------

CREATE OR REPLACE FUNCTION public.propagate_pm_template_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.checklist_items (schedule_id, description, item_type, unit, sort_order, template_item_id)
    SELECT rs.id, NEW.description, NEW.item_type, NEW.unit, NEW.sort_order, NEW.id
    FROM public.recurring_schedules rs
    WHERE rs.pm_template_id = NEW.template_id
      AND rs.active = true;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.checklist_items
    SET description = NEW.description,
        item_type   = NEW.item_type,
        unit        = NEW.unit,
        sort_order  = NEW.sort_order
    WHERE template_item_id = NEW.id;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    -- Soft delete only -- wo_checklist_results may still reference these rows.
    UPDATE public.checklist_items
    SET active = false
    WHERE template_item_id = OLD.id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_pm_template_item_change ON public.equipment_type_pm_template_items;
CREATE TRIGGER trg_propagate_pm_template_item_change
AFTER INSERT OR UPDATE OR DELETE ON public.equipment_type_pm_template_items
FOR EACH ROW EXECUTE FUNCTION public.propagate_pm_template_item_change();

-- 5. Propagation trigger for template-level field edits ------------------

CREATE OR REPLACE FUNCTION public.propagate_pm_template_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.recurring_schedules
  SET title = NEW.title,
      interval_days = NEW.interval_days,
      reminder_days_before = NEW.reminder_days_before
      -- next_due_at intentionally NOT recalculated here -- see file header.
  WHERE pm_template_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_pm_template_change ON public.equipment_type_pm_templates;
CREATE TRIGGER trg_propagate_pm_template_change
AFTER UPDATE ON public.equipment_type_pm_templates
FOR EACH ROW EXECUTE FUNCTION public.propagate_pm_template_change();

COMMIT;
