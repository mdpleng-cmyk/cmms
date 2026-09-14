-- Add section and tool support to PM templates and checklist items
-- Allows organizing PM checklists into headings/sections (e.g. ISOLATION, MAIN MOTOR)
-- and specifying tool requirements (e.g. 7mm socket, Allen key).

BEGIN;

-- 1. Add section and tool columns -------------------------------------------
ALTER TABLE public.equipment_type_pm_template_items
  ADD COLUMN IF NOT EXISTS section text,
  ADD COLUMN IF NOT EXISTS tool text;

ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS section text,
  ADD COLUMN IF NOT EXISTS tool text,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_checklist_items_section
  ON public.checklist_items(section);

-- 2. Update the stamp trigger to copy section and tool on asset creation ----
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
      schedule_id, description, item_type, unit, sort_order, template_item_id, section, tool
    )
    SELECT
      v_schedule_id, description, item_type, unit, sort_order, id, section, tool
    FROM public.equipment_type_pm_template_items
    WHERE template_id = v_template.id;
  END LOOP;

  RETURN NEW;
END;
$$;

-- 3. Update propagation trigger to sync section and tool changes ------------
CREATE OR REPLACE FUNCTION public.propagate_pm_template_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.checklist_items (schedule_id, description, item_type, unit, sort_order, template_item_id, section, tool)
    SELECT rs.id, NEW.description, NEW.item_type, NEW.unit, COALESCE(NEW.sort_order, 1), NEW.id, NEW.section, NEW.tool
    FROM public.recurring_schedules rs
    WHERE rs.pm_template_id = NEW.template_id
      AND rs.active = true;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.checklist_items
    SET description = NEW.description,
        item_type   = NEW.item_type,
        unit        = NEW.unit,
        sort_order  = NEW.sort_order,
        section     = NEW.section,
        tool        = NEW.tool
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

COMMIT;

