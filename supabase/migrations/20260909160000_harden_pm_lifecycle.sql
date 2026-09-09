-- PM lifecycle hardening: immutable due date, integrity, atomic generation,
-- atomic completion, and one active PM work order per schedule.
BEGIN;

ALTER TABLE public.work_orders
  ADD COLUMN scheduled_due_at date;

-- Before hardening, an open PM's schedule has not advanced on its behalf, so
-- the current schedule due date is the best available occurrence due date.
-- Closed historical PMs intentionally remain NULL: their original due date
-- cannot be reconstructed reliably after schedule advancement.
UPDATE public.work_orders AS wo
SET scheduled_due_at = schedule.next_due_at
FROM public.recurring_schedules AS schedule
WHERE wo.type = 'pm'
  AND wo.status IN ('open', 'in_progress', 'waiting_parts')
  AND wo.scheduled_due_at IS NULL
  AND wo.schedule_id = schedule.id
  AND wo.asset_id = schedule.asset_id;

ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_pm_requires_schedule
  CHECK (type <> 'pm' OR schedule_id IS NOT NULL);

CREATE UNIQUE INDEX work_orders_one_active_pm_per_schedule
  ON public.work_orders (schedule_id)
  WHERE type = 'pm'
    AND status IN ('open', 'in_progress', 'waiting_parts');

CREATE OR REPLACE FUNCTION public.enforce_pm_work_order_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  schedule_asset_id bigint;
BEGIN
  IF NEW.type <> 'pm' THEN
    RETURN NEW;
  END IF;

  IF NEW.asset_id IS NULL OR NEW.schedule_id IS NULL THEN
    RAISE EXCEPTION 'PM work orders require an asset and schedule';
  END IF;

  SELECT asset_id
  INTO schedule_asset_id
  FROM public.recurring_schedules
  WHERE id = NEW.schedule_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PM schedule does not exist';
  END IF;

  IF schedule_asset_id IS DISTINCT FROM NEW.asset_id THEN
    RAISE EXCEPTION 'PM work order asset must match its schedule asset';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.scheduled_due_at IS NULL THEN
    RAISE EXCEPTION 'PM work orders require an original scheduled due date';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.scheduled_due_at IS NOT NULL
     AND NEW.scheduled_due_at IS DISTINCT FROM OLD.scheduled_due_at THEN
    RAISE EXCEPTION 'PM original scheduled due date is immutable';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'closed'
     AND NEW.status IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'Closed PM work orders cannot be reopened';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_pm_work_order_integrity
BEFORE INSERT OR UPDATE OF type, asset_id, schedule_id, scheduled_due_at, status
ON public.work_orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_pm_work_order_integrity();

CREATE OR REPLACE FUNCTION public.prevent_pm_schedule_asset_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id
     AND EXISTS (
       SELECT 1
       FROM public.work_orders
       WHERE type = 'pm'
         AND schedule_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'Cannot change the asset of a schedule with PM work order history';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_pm_schedule_asset_reassignment
BEFORE UPDATE OF asset_id ON public.recurring_schedules
FOR EACH ROW
EXECUTE FUNCTION public.prevent_pm_schedule_asset_reassignment();

CREATE OR REPLACE FUNCTION public.generate_pm_work_order(p_schedule_id bigint)
RETURNS TABLE (
  wo_id bigint,
  asset_id bigint,
  schedule_id bigint,
  scheduled_due_at date,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  schedule_row public.recurring_schedules%ROWTYPE;
  work_order_row public.work_orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL
     OR public.current_role_name() NOT IN ('admin', 'technician') THEN
    RAISE EXCEPTION 'Not authorized to generate PM work orders';
  END IF;

  SELECT *
  INTO schedule_row
  FROM public.recurring_schedules
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PM schedule not found';
  END IF;
  IF NOT schedule_row.active THEN
    RAISE EXCEPTION 'PM schedule is disabled';
  END IF;
  IF schedule_row.asset_id IS NULL THEN
    RAISE EXCEPTION 'PM schedule requires an asset';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.work_orders
    WHERE schedule_id = schedule_row.id
      AND type = 'pm'
      AND status IN ('open', 'in_progress', 'waiting_parts')
  ) THEN
    RAISE EXCEPTION 'An active PM work order already exists for this schedule';
  END IF;

  INSERT INTO public.work_orders (
    asset_id, type, schedule_id, scheduled_due_at, status, priority,
    created_by, description
  ) VALUES (
    schedule_row.asset_id, 'pm', schedule_row.id, schedule_row.next_due_at,
    'open', 'P3', auth.uid(), 'Manually generated PM: ' || schedule_row.title
  )
  RETURNING * INTO work_order_row;

  INSERT INTO public.wo_checklist_results (wo_id, item_id, done)
  SELECT work_order_row.id, item.id, false
  FROM public.checklist_items AS item
  WHERE item.schedule_id = schedule_row.id
    AND item.active = true;

  RETURN QUERY
  SELECT work_order_row.id, work_order_row.asset_id, work_order_row.schedule_id,
         work_order_row.scheduled_due_at, work_order_row.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_pm_work_order(
  p_wo_id bigint,
  p_action_taken text,
  p_parts_used text DEFAULT NULL,
  p_technician text DEFAULT NULL
)
RETURNS TABLE (
  wo_id bigint,
  status text,
  closed_at timestamp with time zone,
  recurrence_advanced boolean,
  next_due_at date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  work_order_row public.work_orders%ROWTYPE;
  schedule_row public.recurring_schedules%ROWTYPE;
  completed_at timestamp with time zone;
  did_advance boolean := false;
BEGIN
  IF auth.uid() IS NULL
     OR public.current_role_name() NOT IN ('admin', 'technician') THEN
    RAISE EXCEPTION 'Not authorized to complete PM work orders';
  END IF;
  IF btrim(coalesce(p_action_taken, '')) = '' THEN
    RAISE EXCEPTION 'Action Taken is required to close a PM work order';
  END IF;

  SELECT *
  INTO work_order_row
  FROM public.work_orders
  WHERE id = p_wo_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PM work order not found';
  END IF;
  IF work_order_row.type <> 'pm' THEN
    RAISE EXCEPTION 'Work order is not a PM work order';
  END IF;
  IF work_order_row.status = 'closed' THEN
    RAISE EXCEPTION 'PM work order is already closed';
  END IF;
  IF work_order_row.status NOT IN ('open', 'in_progress', 'waiting_parts') THEN
    RAISE EXCEPTION 'PM work order cannot be closed from its current status';
  END IF;
  IF work_order_row.asset_id IS NULL OR work_order_row.schedule_id IS NULL THEN
    RAISE EXCEPTION 'PM work order has invalid asset or schedule data';
  END IF;

  SELECT *
  INTO schedule_row
  FROM public.recurring_schedules
  WHERE id = work_order_row.schedule_id
  FOR UPDATE;

  IF NOT FOUND OR schedule_row.asset_id IS DISTINCT FROM work_order_row.asset_id THEN
    RAISE EXCEPTION 'PM work order asset does not match its schedule';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wo_checklist_results
    WHERE wo_id = work_order_row.id
      AND done = false
  ) THEN
    RAISE EXCEPTION 'PM checklist is incomplete';
  END IF;

  completed_at := now();
  UPDATE public.work_orders
  SET status = 'closed',
      closed_at = completed_at
  WHERE id = work_order_row.id;

  INSERT INTO public.wo_visits (
    wo_id, visit_type, action_taken, parts_used, technician, logged_by, visited_at
  ) VALUES (
    work_order_row.id, 'closed', btrim(p_action_taken), nullif(btrim(p_parts_used), ''),
    nullif(btrim(p_technician), ''), auth.uid(), completed_at
  );

  IF schedule_row.active THEN
    UPDATE public.recurring_schedules
    SET next_due_at = completed_at::date + interval '1 day' * schedule_row.interval_days
    WHERE id = schedule_row.id;
    did_advance := true;
  END IF;

  RETURN QUERY
  SELECT work_order_row.id, 'closed'::text, completed_at, did_advance,
         CASE
           WHEN did_advance THEN completed_at::date + schedule_row.interval_days
           ELSE schedule_row.next_due_at
         END;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_pm_work_order(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_pm_work_order(bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_pm_work_order(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pm_work_order(bigint, text, text, text) TO authenticated;

COMMIT;
