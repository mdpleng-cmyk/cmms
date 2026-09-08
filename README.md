# MDPL CMMS — Project Module Map
_Give this whole file to any AI assistant as context before asking for changes._

## ⚠️ Critical schema fact — read before writing ANY SQL
**Every primary key in this schema is `bigint generated always as identity`, NOT `uuid`.** This includes every CMMS table — `assets.id`, `work_orders.id`, `recurring_schedules.id`, `checklist_items.id`, `wo_checklist_results.id`, `asset_specs.id`, `wo_visits.id`, `equipment_types.id`, `equipment_type_pm_templates.id`, `equipment_type_pm_template_items.id`, `notes.id`. The only legitimate `uuid` columns reference Supabase Auth's `auth.users.id` — e.g. `work_orders.created_by`, `user_roles.user_id`, `wo_visits.logged_by`, `notes.created_by`.
**Lesson learned**: an earlier AI session, working from a generic schema pattern instead of this project's real one, wrote a new table with `uuid` keys and a `uuid → bigint` FK, which fails at creation. Any new table must use `bigint generated always as identity` and match `bigint` for any FK within this schema.

## ⚠️ Sync-status note — read this before trusting anything below as gospel
This project has repeatedly drifted from what an AI assumed was "current" vs. what was actually live — the fix every time was asking the user to paste the real file rather than guessing twice. As of the latest session:
- **Confirmed correct via a full, most-recent paste**: `js/workOrders.js`.
- **One fix delivered since its last confirmed paste, not yet reconfirmed**: `js/app.js` (an import-list fix for `startEditWoMeta`/`cancelWoMetaEdit`/`saveWoMetaEdit`).
- **Several edits delivered since their last confirmed paste, not yet reconfirmed**: `js/overview.js` (a query-syntax fix, priority-first sort fix, `other`-type de-emphasis), `style.css` (scrollbar styling, `color-scheme: dark`, `.badge.other`).
- **Not fully repasted since before the whole Overview "Today" redesign began**, despite many edits to its WO modals since: `index.html`.

**Rule going forward**: before editing any file, if it hasn't been pasted fresh in the current conversation, ask for it. Don't assume a described edit landed — the user may have skipped it, applied it partially, or hit a mismatch and moved on without saying so explicitly.

## Status right now
- **Database**: Supabase (Postgres), own project — separate from the telemetry/meter-reading project (deliberately not merged).
- **Frontend**: modular ES6 app, GitHub Pages, no build step.
- **Auth**: Supabase Auth (email/password) + `user_roles` for RBAC (`admin` / `technician` / `viewer`).

## Database schema (current, in full)
```
assets                        id, name, location, department (free text, dropdown-constrained in UI only),
                               criticality (P1-P4), status, category, equipment_type_id→equipment_types (nullable),
                               created_at
work_orders                    id, asset_id→assets, type (breakdown|pm|other), status (open|in_progress|closed|waiting_parts),
                               description, priority (P1-P4, nullable), planned_date (date, nullable),
                               opened_at, closed_at, created_by→auth.users, schedule_id→recurring_schedules
wo_status_history               id, wo_id→work_orders, status, changed_by→auth.users, changed_at, note   [auto-populated by trigger — status transitions ONLY]
wo_visits                       id, wo_id→work_orders, visit_type (update|closed|awaiting_spares|edited),
                               action_taken, parts_used, technician, logged_by→auth.users, visited_at
recurring_schedules              id, asset_id→assets, title, interval_days, recalc_from, next_due_at,
                               reminder_days_before, snoozed_until (timestamptz, nullable), active
checklist_items                  id, schedule_id→recurring_schedules, description, item_type (check|reading),
                               unit, active, added_at
wo_checklist_results              id, wo_id→work_orders, item_id→checklist_items, done, done_at, note,
                               result_check (bool), result_value (numeric)
asset_specs                      id, asset_id→assets, label, value, unit, sort_order, created_at
notes                            id, text, done, created_by→auth.users, created_at
user_roles                       user_id→auth.users (uuid, the one legit uuid FK), role, full_name
equipment_types                  id, name (unique), created_at
equipment_type_pm_templates       id, equipment_type_id→equipment_types, title, interval_days, reminder_days_before
equipment_type_pm_template_items   id, template_id→equipment_type_pm_templates, description, item_type, unit, sort_order
```

**`work_orders.type = 'other'`**: catch-all for work not really about equipment maintenance — procurement, admin tasks, one-off requests (e.g. "source a belt from an alternate vendor"). Deliberately NOT named "General" since an actual asset is named that — would've been confusing in conversation and reports. Same full lifecycle as breakdown/pm (create/update/close/visit-log) — no special-cased logic elsewhere. In Overview's Open WO list, `other` rows are visually de-emphasized (muted gray name instead of amber) and sorted after same-priority real maintenance work.

**`work_orders.planned_date`**: settable in both the New WO form and the Update modal, behind a "+ Set a planned date" toggle (auto-expanded if already set). A WO with a *future* planned_date is exempt from staleness tracking. Once that date passes, staleness starts counting fresh **from the planned date**, not the original creation time — this was an explicit design call, not a default assumption.

**Staleness** (Overview's Open Work Orders panel): `STALE_DAYS = 2`. `staleDaysFor(wo, latestVisit, todayStart)` returns 0 (not stale) if `status = 'waiting_parts'`, or if `planned_date` is still in the future. Otherwise counts days since the later of (last `wo_visits` entry, or `opened_at`/`planned_date` if passed). Rendered as a red "No update Xd" badge on the row.

**Equipment classes ("is there more than one of this?")**: `equipment_types` holds a class like "AC" or "FFS". `equipment_type_pm_templates`/`_items` define that class's default PM checklist. A Postgres trigger (`stamp_pm_template_on_asset`, `AFTER INSERT ON assets`, `security definer`) copies the template into a real `recurring_schedules` + `checklist_items` for a new asset **only at creation time**, only if `equipment_type_id` was set. This is a **stamp, not a live link** — editing a class's template later never touches assets already created with that class. Deliberate, informed by this project's own GAS history (an earlier live-linked Template+Asset Matrix system was replaced with per-asset tasks specifically because keeping template and per-machine reality in sync got complicated). Don't rebuild a live-linked version without re-litigating that decision explicitly.

**New Asset form flow** (user-designed, don't simplify away): a checkbox ("Do you have multiple similar items?") reveals a class dropdown with inline "+ Create new class..." — no detour to Manage required. Picking/creating a class auto-suggests a name (`"<Class> <N+1>"`) if the name field is still empty. Defining a class's PM checklist still happens only in Manage → Equipment Types.

**Explicitly NOT built** (proposed, pushed back on as over-complex, deferred): per-asset "reassign class" dropdown in Manage, bulk multi-select class assignment, "apply template retroactively" button. If wanted later, treat as a fresh, smaller ask.

**`work_orders.priority`**: independent of `assets.criticality`. Criticality is static per-asset; priority is per-incident, defaults from the asset's criticality at WO creation (form default is always **P3/Normal**) but is user-overridable, and editable afterward inline in the WO Detail modal (see below). Null `priority` (legacy rows) falls back to deriving a label from asset criticality — see `priorityMeta()` in `store.js`.

**"Already done, log and close now"** in the New WO form reveals real start/end `datetime-local` inputs for backdating, PLUS Action Taken/Parts/Technician fields — closing this way now creates a real `wo_visits` row (`visit_type='closed'`, timestamped at the entered close time) so the WO isn't left with zero history. Breakdown-type still requires Action Taken text.

**`wo_visits` editing**: entries are editable (pencil icon) within an **8-hour window**, enforced both in the UI (icon only shows if within window) and in RLS itself (`visited_at > now() - interval '8 hours'` in the update policy) — not just a client-side check. Admin/technician only.

**WO Detail metadata editing**: description and priority are editable inline in the WO Detail header (pencil icon). This does NOT touch `wo_status_history`. If either value actually changed, it writes a `wo_visits` row with `visit_type='edited'` and a plain-language diff (e.g. `"Priority: P3 → P1; Description updated"`) — keeps a trace without repurposing the status-audit trail for non-status changes.

**Manual PM generation**: each PM schedule card in the PMs tab has a "Generate WO Now" button (`generatePmWoNow()` in `schedules.js`) — same insert shape any future automatic due-date trigger should reuse. No automatic trigger exists yet.

**PM snooze**: `recurring_schedules.snoozed_until`. Shared across all users (not per-viewer). Snoozing only affects Overview's PM Due display — never touches `next_due_at`, so the real schedule is untouched. Snoozed items still show, in a separate "Snoozed:" line, not hidden entirely.

**`work_orders.status` note**: check constraint must allow `'open','in_progress','closed','waiting_parts'` — flagged once as possibly out of sync, never independently re-verified against the live DB.

**Trigger**: `log_wo_status_change()` on `work_orders` (insert + update of status) auto-writes `wo_status_history`. Must be `security definer` + `set search_path = public`.

**`wo_visits` vs `wo_status_history`**: two different tables, don't conflate. `wo_status_history` is automatic/trigger-written, pure status audit — never write to it manually, and metadata edits (priority/description) don't belong there either (see above — they go to `wo_visits` as `'edited'`). `wo_visits` is the human-written field record. **Never** append notes onto `work_orders.description` — tried once, caused unbounded text growth, replaced by `wo_visits`.

## RLS pattern (every CMMS table except `user_roles`)
`admin`: full access. `technician`: read all, write work_orders/wo_visits/schedules/checklist_items/asset_specs/equipment_types/templates/notes. `viewer`: read-only. Enforced via shared helper `current_role_name()`. `wo_visits` additionally has a time-boxed UPDATE policy (8-hour edit window, see above) — this was originally missing entirely (select+insert only) and had to be added.

## Cross-project telemetry integration
Overview's "Meter Readings" panel reads live from the **separate** telemetry/meter-reading Supabase project via a second client (`sbTelemetry` in `store.js`), anonymous, read-only. Works because that project's `meter_readings`/`meters` tables have anonymous-read RLS policies added specifically for this. If a cross-project read ever silently returns `[]`, that's RLS blocking it (Postgres RLS returns empty, not an error) — verify with a raw `fetch()` + apikey header before assuming no data exists. The panel shows the latest reading's `consumption` (telemetry's precomputed per-reading delta) against a 30-day average per meter, with a delta%, not a raw cumulative value. Meter icon/color is a heuristic match on `meter_type`/name/unit text (exact `meter_type` enum values on the telemetry side were never confirmed) — tighten `meterVisual()` if icons come out wrong.

## Frontend structure
```
/
├── index.html      — SPA shell: header (logo, global "New WO" button, persistent date, sign-out), tab nav
│                      (Overview / Work Orders / Assets / PMs / Manage), all modals
├── style.css        — dark palette, all component styling, `.ov-*` = Overview-only desktop-dense classes
└── js/
    ├── store.js               — `sb` (CMMS) + `sbTelemetry` (telemetry, read-only) clients, shared `state`,
    │                              toast/loading/format/escape utilities, `priorityMeta()`
    ├── app.js                 — tab switching, global event binding, exposes functions on `window`,
    │                              writes the persistent header date on load
    ├── auth.js                 — signIn/signOut/onSignedIn (calls loadOverview() on login)
    ├── assets.js                — asset CRUD incl. class-selection flow on the New Asset form, Asset
    │                              Profile modal (glyph/status/specs rail + Open WO/PM/History tabs),
    │                              asset search dropdown (red dot = has an open breakdown)
    ├── workOrders.js            — WO create/list/filter, WO Detail modal (inline-editable description/
    │                              priority via renderWoDetailHeader's edit mode), update flow + wo_visits
    │                              timeline (inline-editable within 8h), checklist (check+reading),
    │                              backdated close with full visit capture, planned-date toggle,
    │                              asset-status cache
    ├── schedules.js              — recurring schedule CRUD, checklist items, "Generate WO Now" per schedule
    ├── manage.js                 — Manage tab, two modes: Assets (name/location/department/criticality/
    │                              category/specs — NOT reachable from the Asset Profile modal, by design)
    │                              and Equipment Types (create a class, define its PM template + checklist)
    ├── overview.js               — default landing tab, "Today" briefing layout (NOT KPI tiles — see
    │                              design decisions): Open Work Orders + PM Due (paired, primary row),
    │                              Recent Activity + Meter Readings + Reminders (secondary row)
    ├── assetSpecs.js             — CRUD helpers for asset_specs
    ├── assetGlyphs.js            — SVG glyph-per-category lookup
    └── assetDetailHelpers.js     — getAssetStatus(), getAllWatchItemsForAsset()
```

## Design decisions worth knowing (so they don't get re-litigated)
- **Asset Profile is a modal** (`.asset-modal-box`, max-width 900px) — a full-screen takeover was built and reverted (lost scroll position in the underlying list).
- **WO list is a summary; WO Detail is its own modal** — the list embedding full checklist+timeline per card didn't scale.
- **Specs/category/name/location/department/criticality editing lives ONLY in Manage**, never inline in the Asset Profile modal.
- **PM schedule editing** happens only in the PMs tab — Asset Profile's PM section is view-only with "Edit →".
- **Equipment-class templates are a one-time stamp, not a live link** — see schema section above.
- **PM-type work orders cannot be created without a schedule selected.**
- **Priority defaults to Normal (P3)** on the New WO form.
- **Overview's KPI tiles were built, removed, rebuilt with a different set, then removed again** in favor of the current "Today" briefing layout (Open WO / PM Due / Recent Activity / Meter Readings / Reminders). This has flip-flopped enough times that it should NOT be treated as settled either way — check with the user before reintroducing or removing KPI tiles again.
- **Reminders panel is freeform notes only** — schedule-based due-date reminders live in PM Due instead, specifically to avoid showing the same upcoming-PM information in two places at once.
- **PM snooze is shared, not per-user**, and never touches the real `next_due_at` — purely a display suppression with a visible "still snoozed" trace.
- **Metadata edits (priority/description) are visit-log entries (`visit_type='edited'`), never status-history entries** — this preserves `wo_status_history` as a pure, trigger-only status audit trail.
- **Every fix gets logged**, even same-day trivial ones. Backdated close times now capture full visit details (action/parts/technician), not just a timestamp.
- **Multi-project split**: telemetry + meter-reading share one Supabase project; CMMS is separate; Overview reads telemetry read-only across projects.

## Not yet built
- Automatic PM generation on `next_due_at` (manual only, via `generatePmWoNow()` or the New WO form).
- Reminder delivery for `reminder_days_before` on schedules (distinct from the manual snooze feature, which is built).
- Trend view for `wo_checklist_results.result_value` over time.
- Retroactive class assignment / bulk-assign UI for equipment types (proposed, explicitly deferred).
- Dedicated "all meter readings" / "all activity" pages (Overview only shows recent/latest slices of each).

## Immediate next steps (pick up here)
1. **Get fresh pastes of `index.html`, `js/overview.js`, `style.css`, and `js/app.js`** before further edits — see the sync-status note at the top; these have layered unconfirmed changes.
2. Confirm the `waiting_parts` status constraint and the `assets.department` column are both actually live (never independently re-verified).
3. Clean up the harmless duplicate `window.saveManageAssetField` binding in `app.js`.
4. Decide + build automatic PM generation and `reminder_days_before` delivery.
5. If meter icons look wrong, get real `meter_type` sample values from the telemetry project and tighten `meterVisual()`.