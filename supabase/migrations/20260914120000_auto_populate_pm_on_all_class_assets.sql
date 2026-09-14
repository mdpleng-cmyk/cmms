-- Auto-populate PM schedules on ALL existing assets of an equipment class
-- whenever a template or template item is created or updated.

BEGIN;

-- 1. Ensure checklist_items has sort_order column
ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 1;

-- 2. Immediate backfill: populate PM schedules for all existing assets in every class
INSERT INTO public.recurring_schedules (
  asset_id, title, interval_days, next_due_at, reminder_days_before, pm_template_id
)
SELECT
  a.id, t.title, t.interval_days,
  CURRENT_DATE + t.interval_days,
  t.reminder_days_before, t.id
FROM public.assets a
JOIN public.equipment_type_pm_templates t
  ON t.equipment_type_id = a.equipment_type_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.recurring_schedules rs
  WHERE rs.asset_id = a.id AND rs.pm_template_id = t.id
);

-- Copy all template items to any machine schedule that is missing them
INSERT INTO public.checklist_items (
  schedule_id, description, item_type, unit, sort_order, template_item_id, section, tool
)
SELECT
  rs.id, ti.description, ti.item_type, ti.unit, ti.sort_order, ti.id, ti.section, ti.tool
FROM public.recurring_schedules rs
JOIN public.equipment_type_pm_template_items ti
  ON ti.template_id = rs.pm_template_id
WHERE rs.active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.checklist_items ci
    WHERE ci.schedule_id = rs.id
      AND (ci.template_item_id = ti.id OR lower(trim(ci.description)) = lower(trim(ti.description)))
  );

-- 3. Upgrade trigger on equipment_type_pm_templates to auto-create schedules on existing assets
CREATE OR REPLACE FUNCTION public.propagate_pm_template_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Update existing schedules
  UPDATE public.recurring_schedules
  SET title = NEW.title,
      interval_days = NEW.interval_days,
      reminder_days_before = NEW.reminder_days_before
  WHERE pm_template_id = NEW.id;

  -- Ensure any existing asset in this equipment class has a schedule
  INSERT INTO public.recurring_schedules (
    asset_id, title, interval_days, next_due_at, reminder_days_before, pm_template_id
  )
  SELECT
    a.id, NEW.title, NEW.interval_days,
    CURRENT_DATE + NEW.interval_days,
    NEW.reminder_days_before, NEW.id
  FROM public.assets a
  WHERE a.equipment_type_id = NEW.equipment_type_id
    AND NOT EXISTS (
      SELECT 1 FROM public.recurring_schedules rs
      WHERE rs.asset_id = a.id AND rs.pm_template_id = NEW.id
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_pm_template_change ON public.equipment_type_pm_templates;
CREATE TRIGGER trg_propagate_pm_template_change
AFTER INSERT OR UPDATE ON public.equipment_type_pm_templates
FOR EACH ROW EXECUTE FUNCTION public.propagate_pm_template_change();

-- 4. Upgrade trigger on equipment_type_pm_template_items
CREATE OR REPLACE FUNCTION public.propagate_pm_template_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Ensure all assets of this class have a schedule
    INSERT INTO public.recurring_schedules (
      asset_id, title, interval_days, next_due_at, reminder_days_before, pm_template_id
    )
    SELECT
      a.id, t.title, t.interval_days,
      CURRENT_DATE + t.interval_days,
      t.reminder_days_before, t.id
    FROM public.assets a
    JOIN public.equipment_type_pm_templates t
      ON t.id = NEW.template_id
    WHERE a.equipment_type_id = t.equipment_type_id
      AND NOT EXISTS (
        SELECT 1 FROM public.recurring_schedules rs
        WHERE rs.asset_id = a.id AND rs.pm_template_id = t.id
      );

    -- Insert item to all schedules for this template
    INSERT INTO public.checklist_items (
      schedule_id, description, item_type, unit, sort_order, template_item_id, section, tool
    )
    SELECT rs.id, NEW.description, NEW.item_type, NEW.unit, COALESCE(NEW.sort_order, 1), NEW.id, NEW.section, NEW.tool
    FROM public.recurring_schedules rs
    WHERE rs.pm_template_id = NEW.template_id
      AND rs.active = true
      AND NOT EXISTS (
        SELECT 1 FROM public.checklist_items ci
        WHERE ci.schedule_id = rs.id AND ci.template_item_id = NEW.id
      );
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
    UPDATE public.checklist_items
    SET active = false
    WHERE template_item_id = OLD.id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
