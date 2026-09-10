-- Change the initial next_due_at in the stamp_pm_template_on_asset trigger
-- from: current_date + v_template.interval_days
-- to:   NEW.created_at::date + v_template.interval_days
--
-- All other behaviour is preserved exactly:
--   - AFTER INSERT ON assets, SECURITY DEFINER, SET search_path TO 'public'
--   - No-op when equipment_type_id IS NULL
--   - Loop over all equipment_type_pm_templates for the type
--   - Insert one recurring_schedules row per template
--   - Copy equipment_type_pm_template_items into checklist_items
--   - Return NEW unchanged
--
-- Subsequent recurrence (after PM completion) is NOT affected:
-- complete_pm_work_order() advances next_due_at using
-- completed_at::date + interval_days, which is unchanged.

BEGIN;

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
  -- Only stamp when the asset is assigned to an equipment type.
  IF NEW.equipment_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Loop over every PM template defined for this equipment type.
  -- (In current usage there is at most one template per type, but the loop
  -- is preserved as-is so future multi-template support is not broken.)
  FOR v_template IN
    SELECT *
    FROM public.equipment_type_pm_templates
    WHERE equipment_type_id = NEW.equipment_type_id
  LOOP
    -- Create the per-asset recurring schedule.
    -- CHANGED: next_due_at now uses NEW.created_at::date instead of current_date.
    INSERT INTO public.recurring_schedules (
      asset_id,
      title,
      interval_days,
      next_due_at,
      reminder_days_before
    ) VALUES (
      NEW.id,
      v_template.title,
      v_template.interval_days,
      NEW.created_at::date + v_template.interval_days,   -- ← changed line
      v_template.reminder_days_before
    )
    RETURNING id INTO v_schedule_id;

    -- Copy the template's checklist items into per-asset checklist_items rows.
    INSERT INTO public.checklist_items (
      schedule_id,
      description,
      item_type,
      unit,
      sort_order
    )
    SELECT
      v_schedule_id,
      description,
      item_type,
      unit,
      sort_order
    FROM public.equipment_type_pm_template_items
    WHERE template_id = v_template.id;

  END LOOP;

  RETURN NEW;
END;
$$;

COMMIT;

