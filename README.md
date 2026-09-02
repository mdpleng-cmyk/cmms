# MDPL CMMS — Project Module Map
_Give this whole file to any AI assistant as context before asking for changes._

## ⚠️ Critical schema fact — read before writing ANY SQL
**Every primary key in this schema is `bigint generated always as identity`, NOT `uuid`.**
This includes `assets.id`, `work_orders.id`, `recurring_schedules.id`, `checklist_items.id`, `wo_checklist_results.id`, `asset_specs.id`, `wo_visits.id`. The only legitimate `uuid` columns reference Supabase Auth's `auth.users.id` — e.g. `work_orders.created_by`, `user_roles.user_id`, `wo_visits.logged_by`.
**Lesson learned**: an earlier AI session, working from a generic schema pattern instead of this project's real one, wrote a new table with `uuid` keys and a `uuid → bigint` foreign key, which fails at creation. Any new table must use `bigint generated always as identity` for its own key and match `bigint` for any FK within this schema.

## Status right now
- **Database**: Supabase (Postgres), own project — separate from the telemetry/meter-reading project (deliberately not merged; see cross-project section below).
- **Frontend**: modular ES6 app, GitHub Pages, no build step.
- **Auth**: Supabase Auth (email/password) + `user_roles` for RBAC (`admin` / `technician` / `viewer`).

## Database schema (current, in full)
```
assets                 id, name, location, criticality (P1-P4), status, category, created_at
work_orders             id, asset_id→assets, type (breakdown|pm), status (open|in_progress|closed|waiting_parts),
                         description, priority (P1-P4, nullable), opened_at, closed_at,
                         created_by→auth.users, schedule_id→recurring_schedules
wo_status_history       id, wo_id→work_orders, status, changed_by→auth.users, changed_at, note   [auto-populated by trigger]
wo_visits               id, wo_id→work_orders, visit_type (update|closed|awaiting_spares),
                         action_taken, parts_used, technician, logged_by→auth.users, visited_at
recurring_schedules     id, asset_id→assets, title, interval_days, recalc_from, next_due_at, reminder_days_before, active
checklist_items         id, schedule_id→recurring_schedules, description, item_type (check|reading), unit, active, added_at
wo_checklist_results    id, wo_id→work_orders, item_id→checklist_items, done, done_at, note,
                         result_check (bool, item_type='check'), result_value (numeric, item_type='reading')
asset_specs             id, asset_id→assets, label, value, unit, sort_order, created_at
user_roles              user_id→auth.users (uuid, the one legit uuid FK), role (admin|technician|viewer), full_name
```

**`work_orders.priority`**: added after the base MVP. Independent of `assets.criticality` — criticality is a static property of the asset, priority is per-incident and defaults from the asset's criticality at WO creation time but is user-overridable. Any WO created before this column existed has `priority = null`; the UI falls back to deriving a label from the asset's criticality wherever it displays priority for a null row (see `priorityMeta()` in `store.js`).

**`work_orders.status` note**: check constraint must allow `'open','in_progress','closed','waiting_parts'` — confirm this is actually live before assuming; it was flagged once as possibly out of sync and never explicitly re-verified.

**Trigger**: `log_wo_status_change()` on `work_orders` (insert + update of status) auto-writes `wo_status_history`. Must be `security definer` + `set search_path = public` — RLS on that table only grants read to app roles, so a plain trigger silently fails to log without this.

**`wo_visits` vs `wo_status_history`**: two different tables, don't conflate them. `wo_status_history` is automatic/trigger-written, pure status audit trail — never write to it manually. `wo_visits` is the human-written field record (what a technician did — action taken, parts, who). **Never** append notes onto `work_orders.description` — tried once, caused unbounded text growth, replaced by `wo_visits`. `description` holds only the original problem statement, set once at creation.

## RLS pattern (every table above except `user_roles`)
`admin`: full access. `technician`: read all, write work_orders/wo_visits/schedules/checklist_items/asset_specs. `viewer`: read-only. Enforced via shared helper `current_role_name()` — new tables should call this, not write a fresh `exists(...)` subquery.

## Cross-project telemetry integration
The Overview page's "Meter readings" panel reads live from the **separate** telemetry/meter-reading Supabase project — a second `supabase.createClient(...)` instance (`sbTelemetry`, defined in `store.js`) pointed at that project's URL + anon key, queried read-only, client-side, with no relationship to CMMS's own auth (requests arrive there as anonymous). This works because that project's `latest_meter_readings`/`meters`/`meter_readings` tables have anonymous-read RLS policies (`for select using (true)`) — added specifically to allow this. Two things to remember:
- If a similar cross-project read ever returns `[]` unexpectedly, that's very likely RLS blocking it silently (Postgres RLS returns empty, not an error) — check with a raw `fetch()` + apikey header against that project's REST endpoint before assuming the data doesn't exist.
- `meter_readings.consumption` is the per-reading delta already computed by the telemetry app — the Overview panel takes the most recent row per `meter_id` (dedup client-side, ordered by `recorded_at`) and shows that, not a raw cumulative counter.

## Frontend structure
```
/
├── index.html      — SPA skeleton: header (logo, global "New WO" button, sign-out), tab nav
│                      (Overview / Work Orders / Assets / PMs / Manage), all modals
├── style.css        — dark palette (--bg/--panel/--amber/--green/--red/etc.), all component styling,
│                      including the desktop-dense `.ov-*` classes used only by Overview
└── js/
    ├── store.js               — both Supabase clients (`sb` = CMMS, `sbTelemetry` = telemetry project,
    │                              read-only), shared `state`, toast/loading/format/escape utilities,
    │                              `priorityMeta()` (single source of truth for priority label+color)
    ├── app.js                 — tab switching, global event binding, exposes module functions on `window`
    ├── auth.js                 — signIn/signOut/onSignedIn (calls loadOverview() on login — must, or
    │                              Overview stays blank until the user manually switches tabs and back)
    ├── assets.js                — asset CRUD, Asset Profile modal (glyph/status/specs rail + Open WO/PM/
    │                              History tabs), asset search dropdown (shows a red dot for assets with
    │                              an open breakdown, from `state.assetStatusCache`)
    ├── workOrders.js            — WO create/list/filter, WO Detail modal (own dedicated view — the list
    │                              itself is deliberately lean: badges + 2-line description + date, click
    │                              opens the detail modal), update flow, wo_visits timeline, checklist
    │                              (check + reading types), backdated close (start/end datetime when
    │                              "already done" is checked), asset-status cache refresh
    ├── schedules.js              — recurring schedule CRUD, checklist item management, "Generate WO Now"
    │                              manual trigger per schedule (creates a real work_orders row + seeds
    │                              checklist results — same shape as the automatic path would use, once built)
    ├── manage.js                 — separate Manage tab: category + asset_specs CRUD, deliberately NOT
    │                              reachable from the Asset Profile modal (prevents accidental edits)
    ├── overview.js               — default landing tab. WO queue (full-width, click → WO detail),
    │                              PM due soon, meter readings (telemetry), recent activity (click → WO
    │                              detail) — KPI tiles and zone grid were tried and explicitly dropped
    │                              (felt like noise / buried the WO queue); don't re-add without asking
    ├── assetSpecs.js             — CRUD helpers for asset_specs (used by manage.js)
    ├── assetGlyphs.js            — SVG glyph-per-category lookup (used by assets.js and manage.js)
    └── assetDetailHelpers.js     — getAssetStatus() (derived Running/Under maintenance/Down from open
                                    work_orders, not stored), getAllWatchItemsForAsset()
```

## Design decisions worth knowing (so they don't get re-litigated)
- **Asset Profile is a modal** (`.asset-modal-box`, max-width 900px), not a full page — a full-screen takeover was built and reverted because it lost scroll position in the underlying Assets list.
- **WO list is a summary; WO Detail is its own modal** — the list used to embed the full checklist + visit timeline inline per card, which didn't scale. Now the list is lean (click anywhere on a card, or any WO reference elsewhere in the app, opens the same detail modal).
- **Specs/category editing lives ONLY in Manage**, never inline in the Asset Profile modal.
- **PM schedule editing** happens only in the PMs tab — Asset Profile's PM section is view-only with an "Edit →" link that closes the modal and scrolls to the real card.
- **A dead, never-wired "asset-detail-view" (ad-header/ad-quick-actions/switchAssetDetailTab) existed in `index.html` for a while** — leftover scaffolding from an earlier AI session's incomplete work, no JS ever implemented it. Removed. If you ever see `ad-`-prefixed ids or ask about a "Meter" tab inside an asset page, that's this — it doesn't exist anymore and shouldn't be resurrected without deciding fresh what it should be.
- **PM-type work orders cannot be created without a schedule selected** — enforced in `createWorkOrder()`; earlier it silently created a checklist-less PM WO.
- **Priority defaults to Normal (P3)** on the New WO form, and re-derives from the selected asset's criticality if that asset has one set — but the form's baseline default is always Normal, not blank.
- **Every fix gets logged**, even a same-day trivial one (`opened_at = closed_at = now()`), so asset history stays complete. The "already done, log and close now" path now supports real backdating (explicit start/end datetime) instead of always stamping "now."
- **Multi-project split**: telemetry + meter-reading share one Supabase project; CMMS is separate. Overview reads telemetry read-only across projects (see above) — this is the one place CMMS talks to another project's data.

## Not yet built
- Automatic generation of the next PM work order when `next_due_at` arrives — currently manual only (`generatePmWoNow()` per schedule, or via the New WO form). No scheduled job exists yet.
- Reminder delivery for `reminder_days_before` (column exists, nothing reads it).
- Any UI to browse/trend `wo_checklist_results.result_value` over time — data's being collected in the right shape, no view built yet.

## Immediate next steps (pick up here)
1. Confirm the `waiting_parts` status constraint is actually live.
2. Decide + build automatic PM generation (this would likely reuse the exact insert logic already in `generatePmWoNow()`) and reminder delivery.
3. Once enough reading-type checklist data exists, build a trend view.
4. Consider consolidating `.activity-entry` (asset profile) and `.ov-activity-item` (overview) — same visual pattern, two separate class names; not urgent, flagged as minor tech debt.