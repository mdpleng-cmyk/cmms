# MDPL CMMS — Project Module Map


## Status right now
- **Database**: schema deployed to a fresh personal Supabase project (separate from the telemetry/meter-reading project, which was NOT merged — decided against it).
- **Data**: only `assets` migrated from the legacy Excel CMMS (49 rows, from the "PM Assets" sheet). **No historical work orders were imported** — user chose to start fresh rather than migrate the 28 legacy WO rows.
- **Frontend**: rebuilt from a single-file scaffold into a modular ES6 app (see structure below) with added features beyond the original MVP: asset history modal, custom searchable asset dropdown, unified update/close modal with loading spinners (Lucide icons), toast notifications.
- **Known bug, not yet fixed in DB**: frontend can set `work_orders.status = 'waiting_parts'`, but the DB check constraint doesn't allow it yet. Fix is the ALTER statement above — needs to be run in Supabase SQL Editor.
- **Not yet built**: automatic generation of the next PM work order when `recurring_schedules.next_due_at` arrives (currently manual — user creates a `type='pm'` WO by hand and picks the schedule). No reminder delivery mechanism (the `reminder_days_before` column exists but nothing reads it yet).
- **Hosting**: intended for GitHub Pages, static files, no build step.

## Design decisions worth knowing (so they don't get re-litigated)
- **Multi-project split**: telemetry + meter-reading live in one Supabase project (`public` schema, both apps share a unified `operators` table keyed by `level`). CMMS is a **separate** Supabase project — different domain, own quota, own auth model (`user_roles`, not `operators`).
- **Current-state + append-only history**: `work_orders` holds current state; `wo_status_history` is an append-only audit trail, auto-populated by a trigger (see fix above) on every insert/status change. This is deliberate — it's what makes the data analyzable in pandas later (WO lifetimes, reopen counts, etc.) without fighting mutated rows.
- **Recurring PM pattern**: `recurring_schedules` (the periodic rule) is separate from `checklist_items` (a permanent, growing checklist under that schedule) and `wo_checklist_results` (one row per item per occurrence). This supports the actual workflow: a finding (e.g. a loose bolt) gets added as a permanent checklist item on the relevant asset's PM schedule, not as its own one-off recurring schedule.
- **Every fix gets logged**: even a same-day trivial fix creates a `work_orders` row (opened_at = closed_at = now), so asset history stays complete for later analysis. This was a deliberate choice over letting trivial fixes go unlogged.
- **RLS roles**: `admin` (full access), `technician` (read all, write work_orders/schedules/checklist), `viewer` (read-only). Enforced both in UI (buttons hidden) and at the DB via RLS — not just cosmetic.

## Database schema (Postgres / Supabase)
```
assets                 id, name, location, criticality (P1-P4), status, created_at
work_orders             id, asset_id→assets, type (breakdown|pm), status (open|in_progress|closed[|waiting_parts pending fix]),
                         description, opened_at, closed_at, created_by→auth.users, schedule_id→recurring_schedules
wo_status_history       id, wo_id→work_orders, status, changed_by, changed_at, note   [auto-populated by trigger]
recurring_schedules     id, asset_id→assets, title, interval_days, recalc_from, next_due_at, reminder_days_before, active
checklist_items         id, schedule_id→recurring_schedules, description, active, added_at
wo_checklist_results    id, wo_id→work_orders, item_id→checklist_items, done, done_at, note
user_roles              user_id→auth.users, role (admin|technician|viewer), full_name
```
Trigger `log_wo_status_change()` on `work_orders` (insert + update of status) auto-writes to `wo_status_history`. Must be `security definer` + `set search_path = public` (see fix above) — RLS on `wo_status_history` only grants read, not insert, to app roles.

## Frontend structure
```
/
├── index.html      — SPA skeleton: forms, modals (New WO, Close/Update WO, Asset History), inline onclick handlers
├── style.css        — dark palette (CSS vars), layout, modal/toast/spinner styling, custom dropdown
└── js/
    ├── store.js      — Supabase client init, shared `state` object, toast/loading/format/escape utilities
    ├── app.js        — tab switching, global event binding, exposes module functions on `window` for inline onclick
    ├── auth.js        — signIn/signOut/onSignedIn, role-based UI gating
    ├── assets.js      — asset CRUD, asset history modal (last 20 closed WOs per asset), searchable dropdown
    ├── workOrders.js  — WO create/list/filter, unified update modal (status transitions incl. waiting_parts),
    │                    checklist load/toggle for PM-type WOs
    └── schedules.js   — recurring schedule CRUD, checklist item management, populates schedule dropdown on WO form
```

## Immediate next steps (pick up here)
1. Run the `waiting_parts` ALTER statement in Supabase.
2. Decide + build PM auto-generation (Edge Function + `pg_cron`, or a check-on-load) for when `next_due_at` arrives.
3. Decide + build reminder delivery for `reminder_days_before`.
4. Confirm all 49 migrated assets look right in the live Assets tab.