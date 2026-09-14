-- Link existing machine schedules to their equipment type template
-- and sync sections, tools, and missing template items to machine checklists.

BEGIN;

-- 1. Ensure checklist_items has sort_order column
ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 1;

-- 2. Link unlinked recurring_schedules to their asset's equipment type template
UPDATE public.recurring_schedules rs
SET pm_template_id = t.id
FROM public.assets a
JOIN public.equipment_type_pm_templates t
  ON t.equipment_type_id = a.equipment_type_id
WHERE rs.asset_id = a.id
  AND (rs.pm_template_id IS NULL OR rs.pm_template_id != t.id);

-- 3. Link checklist_items to template_item_id by description match and backfill section/tool
UPDATE public.checklist_items ci
SET template_item_id = ti.id,
    section = COALESCE(ci.section, ti.section),
    tool = COALESCE(ci.tool, ti.tool),
    sort_order = COALESCE(ti.sort_order, ci.sort_order, 1)
FROM public.recurring_schedules rs
JOIN public.equipment_type_pm_template_items ti
  ON ti.template_id = rs.pm_template_id
WHERE ci.schedule_id = rs.id
  AND (ci.template_item_id = ti.id OR lower(trim(ci.description)) = lower(trim(ti.description)));

-- 4. Copy any template items that don't exist yet on the machine schedule
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

NOTIFY pgrst, 'reload schema';

COMMIT;
