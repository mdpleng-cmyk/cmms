-- Assetless work orders are valid for reactive and one-off work only.
-- Intentionally leaves the existing assets FK and its ON DELETE behavior unchanged.
BEGIN;

ALTER TABLE public.work_orders
  ALTER COLUMN asset_id DROP NOT NULL;

ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_pm_requires_asset
  CHECK (type <> 'pm' OR asset_id IS NOT NULL);

COMMIT;
