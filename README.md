# MDPL CMMS — Project Module Map
_Give this whole file to any AI assistant as context before asking for changes. It exists specifically so a new AI doesn't have to guess your schema — guessing is what caused the bug this file was rewritten to prevent (see "Lessons learned" below)._

## Status right now
- **Database**: Supabase (Postgres), own project — separate from the telemetry/meter-reading project (deliberately not merged).
- **Data**: assets migrated from legacy Excel CMMS. No historical work orders imported — started fresh.
- **Frontend**: modular ES6 app, hosted on GitHub Pages, no build step. Structure below.
- **Auth**: Supabase Auth (email/password) + `user_roles` table for RBAC. Three roles: `admin`, `technician`, `viewer`.

## ⚠️ Critical schema fact — read before writing ANY SQL
**Every primary key in this schema is `bigint generated always as identity`, NOT `uuid`.**
This includes `assets.id`, `work_orders.id`, `recurring_schedules.id`, `checklist_items.id`, `wo_checklist_results.id`, `asset_specs.id`, `wo_visits.id` — all of them.
The only `uuid` columns in this schema are ones that reference Supabase Auth's built-in `auth.users.id` (which IS uuid) — e.g. `work_orders.created_by`, `user_roles.user_id`, `wo_visits.logged_by`.

**Lesson learned**: another AI was asked to design a new feature (asset specs) and, working from a generic "CMMS schema" pattern rather than this project's actual schema, wrote `asset_specs.id uuid` and `asset_specs.asset_id uuid references assets(id)`. This fails at table-creation time because `assets.id` is `bigint`, not `uuid` — you cannot foreign-key a uuid column to a bigint column. It was caught before running, but wasted a round-trip. **Any new table added to this project must use `bigint generated always as identity` for its own primary key, and must match `bigint` for any foreign key into another table in this schema** — never assume uuid as a default.

## Database schema (current, in full)
```
assets                 id, name, location, criticality (P1-P4), status, category, created_at
work_orders             id, asset_id→assets, type (breakdown|pm), status (open|in_progress|closed|waiting_parts),
                         description, opened_at, closed_at, created_by→auth.users, schedule_id→recurring_schedules
wo_status_history       id, wo_id→work_orders, status, changed_by→auth.users, changed_at, note   [auto-populated by trigger, see below]
wo_visits               id, wo_id→work_orders, visit_type (update|closed|awaiting_spares),
                         action_taken, parts_used, technician, logged_by→auth.users, visited_at
recurring_schedules     id, asset_id→assets, title, interval_days, recalc_from, next_due_at, reminder_days_before, active
checklist_items         id, schedule_id→recurring_schedules, description, item_type (check|reading), unit, active, added_at
wo_checklist_results    id, wo_id→work_orders, item_id→checklist_items, done, done_at, note,
                         result_check (bool, for item_type='check'), result_value (numeric, for item_type='reading')
asset_specs             id, asset_id→assets, label, value, unit, sort_order, created_at
user_roles              user_id→auth.users (uuid, this is the one legit uuid FK), role (admin|technician|viewer), full_name
```

**`work_orders.status` note**: the DB check constraint currently should allow `'open','in_progress','closed','waiting_parts'` — the frontend uses `waiting_parts` in its update flow. If a fresh `alter table work_orders add constraint ... check (status in (...))` doesn't include `waiting_parts`, that's the same class of drift as the uuid bug above — check the live constraint before assuming.

**Trigger**: `log_wo_status_change()` on `work_orders` (insert + update of status) auto-writes to `wo_status_history`. Must be `security definer` + `set search_path = public` — RLS on `wo_status_history` only grants read, not insert, to app roles, so a plain trigger silently fails to log anything without this.

**`wo_visits` vs `wo_status_history`** — these are deliberately two different tables, don't conflate them:
- `wo_status_history` = automatic, trigger-written, pure status audit trail (status changed from X to Y at time T). Never write to this manually.
- `wo_visits` = human-written field record (what a technician actually did — action taken, parts used, who did it). Written by the app on every WO update, alongside (not instead of) the status change.
- **Do not** append notes onto `work_orders.description` — this was tried once (an earlier iteration), caused unbounded text growth on every update, and was replaced by `wo_visits`. `description` should only ever hold the original problem statement, set once at creation.

## RLS pattern (applies to every table above except `user_roles` itself)
- `admin`: full access
- `technician`: read all, write work_orders/wo_visits/schedules/checklist_items/asset_specs
- `viewer`: read-only everywhere
- Enforced via a shared helper: `current_role_name()` (reads `user_roles` for `auth.uid()`) — new tables' RLS policies should call this helper, not write a fresh `exists(select ... from user_roles ...)` subquery each time.

## Frontend structure
```
/
├── index.html      — SPA skeleton: tab nav (Work Orders / Assets / PMs / Manage), forms, modals
├── style.css        — dark palette (CSS vars: --bg, --panel, --amber, --green, --red, etc.), all component styling
└── js/
    ├── store.js               — Supabase client init, shared `state` object, toast/loading/format/escape utilities
    ├── app.js                 — tab switching, global event binding, exposes module functions on `window` for inline onclick
    ├── auth.js                 — signIn/signOut/onSignedIn, role-based UI gating
    ├── assets.js                — asset CRUD, Asset Profile modal (glyph/status/specs rail + Open WO/PM/History tabs)
    ├── workOrders.js            — WO create/list/filter, update modal, wo_visits timeline, checklist load/toggle (check + reading types)
    ├── schedules.js              — recurring schedule CRUD, checklist item management (incl. reading type + unit)
    ├── manage.js                 — separate Manage tab: category + asset_specs CRUD, deliberately NOT reachable from the
    │                              Asset Profile modal (kept apart so specs can't be edited mid-task by accident)
    ├── assetSpecs.js             — CRUD helpers for asset_specs (used by manage.js)
    ├── assetGlyphs.js            — SVG glyph-per-category lookup (used by assets.js and manage.js)
    └── assetDetailHelpers.js     — getAssetStatus() (derived Running/Under maintenance/Down from open work_orders,
                                    not stored), getAllWatchItemsForAsset() (pulls notes off wo_checklist_results)
```

## Design decisions worth knowing (so they don't get re-litigated)
- **Asset Profile is a modal, not a full page** — tried a full-screen takeover, reverted because it lost scroll position in the underlying Assets list. Current version: wider modal (`.asset-modal-box`, max-width 900px) with a rail (glyph/status/specs) + tabbed main area (Open WO/PM/History) inside it.
- **Specs/category editing lives ONLY in the Manage tab**, never inline in the Asset Profile modal — explicit choice to prevent accidental edits while glancing at an asset during regular work.
- **PM schedule editing** happens only in the PMs tab, never inline anywhere else — the Asset Profile modal's PM section is view-only with an "Edit →" link that closes the modal and scrolls to the real card.
- **Checklist items support two types**: `check` (pass/fail) and `reading` (numeric + unit) — added after the base MVP, so any checklist item created before that migration defaults to `check`.
- **Every fix gets logged**, even a same-day trivial one (`opened_at = closed_at = now()`), so asset history stays complete.
- **Multi-project split**: telemetry + meter-reading share one Supabase project (`public` schema, shared `operators` table); CMMS is a separate project entirely.

## Not yet built
- Automatic generation of the next PM work order when `recurring_schedules.next_due_at` arrives (currently manual).
- Reminder delivery for `reminder_days_before` (column exists, nothing reads it yet).
- Any UI to browse/trend `wo_checklist_results.result_value` over time — the data is being collected in the right shape for this, just no view built yet.

## Immediate next steps (pick up here)
1. Confirm the `waiting_parts` status constraint is actually live (see note above).
2. Decide + build PM auto-generation and reminder delivery.
3. Once enough `reading`-type checklist data exists, build a simple trend view per asset/item.