-- Add free-text results for condition-style PM checklist items.

BEGIN;

ALTER TABLE public.wo_checklist_results
  ADD COLUMN IF NOT EXISTS result_text text;

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN (
        'public.checklist_items'::regclass,
        'public.equipment_type_pm_template_items'::regclass
      )
      AND pg_get_constraintdef(oid) ILIKE '%item_type%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', constraint_row.table_name, constraint_row.conname);
  END LOOP;
END $$;

ALTER TABLE public.checklist_items
  ADD CONSTRAINT checklist_items_item_type_check
  CHECK (item_type IN ('check', 'reading', 'text'));

ALTER TABLE public.equipment_type_pm_template_items
  ADD CONSTRAINT equipment_type_pm_template_items_item_type_check
  CHECK (item_type IN ('check', 'reading', 'text'));

COMMIT;
