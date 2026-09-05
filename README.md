# MDPL CMMS — Project Module Map
_Give this whole file to any AI assistant as context before asking for changes._

## ⚠️ Critical schema fact — read before writing ANY SQL
**Every primary key in this schema is `bigint generated always as identity`, NOT `uuid`.** This includes every CMMS table — `assets.id`, `work_orders.id`, `recurring_schedules.id`, `checklist_items.id`, `wo_checklist_results.id`, `asset_specs.id`, `wo_visits.id`, `equipment_types.id`, `equipment_type_pm_templates.id`, `equipment_type_pm_template_items.id`. The only legitimate `uuid` columns reference Supabase Auth's `auth.users.id` — e.g. `work_orders.created_by`, `user_roles.user_id`, `wo_visits.logged_by`.
**Lesson learned**: an earlier AI session, working from a generic schema pattern instead of this project's real one, wrote a new table with `uuid` keys and a `uuid → bigint` FK, which fails at creation. Any new table must use `bigint generated always as identity` and match `bigint` for any FK within this schema.

## ⚠️ Sync-status note — read this before trusting anything below as gospel
Across the session that built the equipment-class system, this map was reconstructed from memory several times and got out of sync with the real deployed files — edits were given against a remembered "current state" that didn't match what the user had actually applied. The fix each time was **asking the user to paste the real file** rather than continuing to guess. Two concrete lessons for whoever picks this up:
1. **Before editing a file you haven't seen pasted in *this* conversation, ask for it.** Don't assume a past turn's proposed edit was actually applied — the user may have skipped it, applied part of it, or applied it differently.
2. **When a find/replace anchor fails ("couldn't find that"), don't guess a second time from memory — ask for the real file immediately.** Guessing twice wastes more of the user's time than asking once.

As of the last messages in that session, these files were **confirmed live via a pasted copy**: `index.html`, `js/assets.js`, `js/manage.js`. These were **delivered but not yet reconfirmed by a fresh paste**: the `assets.department` column + its dropdown UI, and the rewritten `js/overview.js` (KPI row restored, priority+age sort, meter-type icons) + matching `style.css` additions. Treat those two as "should be live" but verify before building further on top of them.

## Status right now
- **Database**: Supabase (Postgres), own project — separate from the telemetry/meter-reading project (deliberately not merged; see cross-project section).
- **Frontend**: modular ES6 app, GitHub Pages, no build step.
- **Auth**: Supabase Auth (email/password) + `user_roles` for RBAC (`admin` / `technician` / `viewer`).

## Database schema (current, in full)
```
assets                        id, name, location, department (free text, dropdown-constrained in UI only,
                               not a DB check constraint), criticality (P1-P4), status, category,
                               equipment_type_id→equipment_types (nullable), created_at
work_orders                    id, asset_id→assets, type (breakdown|pm), status (open|in_progress|closed|waiting_parts),
                               description, priority (P1-P4, nullable), opened_at, closed_at,
                               created_by→auth.users, schedule_id→recurring_schedules
wo_status_history               id, wo_id→work_orders, status, changed_by→auth.users, changed_at, note   [auto-populated by trigger]
wo_visits                       id, wo_id→work_orders, visit_type (update|closed|awaiting_spares),
                               action_taken, parts_used, technician, logged_by→auth.users, visited_at
recurring_schedules              id, asset_id→assets, title, interval_days, recalc_from, next_due_at,
                               reminder_days_before, active
checklist_items                  id, schedule_id→recurring_schedules, description, item_type (check|reading),
                               unit, active, added_at
wo_checklist_results              id, wo_id→work_orders, item_id→checklist_items, done, done_at, note,
                               result_check (bool), result_value (numeric)
asset_specs                      id, asset_id→assets, label, value, unit, sort_order, created_at
user_roles                       user_id→auth.users (uuid, the one legit uuid FK), role, full_name
equipment_types                  id, name (unique), created_at
equipment_type_pm_templates       id, equipment_type_id→equipment_types, title, interval_days, reminder_days_before
equipment_type_pm_template_items   id, template_id→equipment_type_pm_templates, description, item_type, unit, sort_order
```

**Equipment classes ("is there more than one of this?")**: `equipment_types` holds a class like "AC" or "FFS". `equipment_type_pm_templates`/`_items` define that class's default PM checklist. A Postgres trigger (`stamp_pm_template_on_asset`, `AFTER INSERT ON assets`, `security definer`) copies the template into a real `recurring_schedules` + `checklist_items` for a new asset **only at creation time**, only if `equipment_type_id` was set. This is a **stamp, not a live link** — editing a class's template later never touches assets already created with that class. That was a deliberate choice, made after discussing this project's own GAS history: an earlier version of this system (Template + Asset Matrix) tried live-linked templates and was replaced with per-asset tasks specifically because keeping template and per-machine reality in sync got complicated. Don't rebuild a live-linked version without re-litigating that decision explicitly.

**New Asset form flow** (this is the flow the user explicitly designed, don't simplify it away): a checkbox ("Do you have multiple similar items?") reveals a class dropdown with an inline "+ Create new class..." option — no detour to Manage required. Picking/creating a class auto-suggests a name (`"<Class> <N+1>"`) if the name field is still empty. Defining a class's actual PM checklist still happens in Manage → Equipment Types, kept deliberately separate from quick asset creation so the common case (adding one asset) doesn't slow down for the less common one (defining a checklist).

**What was proposed but explicitly NOT built**, so it isn't mistaken for existing: per-asset "reassign class" dropdown in Manage, a bulk multi-select "assign these existing assets to this class" list, and an "apply this class's template retroactively" button. The user pushed back on the complexity of that turn and asked for something simpler (basic name/location/department/criticality editing) instead — which is what's live. If retroactive class assignment is wanted later, it's a fresh, smaller ask, not an assumed feature.

**`work_orders.priority`**: independent of `assets.criticality`. Criticality is static per-asset; priority is per-incident, defaults from the asset's criticality at WO creation (form default is always **P3/Normal**, not blank) but is user-overridable. Null `priority` (legacy rows) falls back to deriving a label from asset criticality wherever displayed — see `priorityMeta()` in `store.js`.

**"Already done, log and close now"** in the New WO form reveals real start/end `datetime-local` inputs for backdating — `opened_at`/`closed_at` are set from those, not just stamped "now."

**Manual PM generation**: each PM schedule card in the PMs tab has a "Generate WO Now" button (`generatePmWoNow()` in `schedules.js`) that creates a real `work_orders` row + seeds `wo_checklist_results` — same insert shape any future automatic due-date trigger should reuse. No automatic trigger exists yet.

**`work_orders.status` note**: check constraint must allow `'open','in_progress','closed','waiting_parts'` — flagged once as possibly out of sync, never independently re-verified against the live DB.

**Trigger**: `log_wo_status_change()` on `work_orders` (insert + update of status) auto-writes `wo_status_history`. Must be `security definer` + `set search_path = public`.

**`wo_visits` vs `wo_status_history`**: two different tables, don't conflate. `wo_status_history` is automatic/trigger-written, pure status audit — never write to it manually. `wo_visits` is the human-written field record. **Never** append notes onto `work_orders.description` — tried once, caused unbounded text growth, replaced by `wo_visits`.

## RLS pattern (every CMMS table except `user_roles`)
`admin`: full access. `technician`: read all, write work_orders/wo_visits/schedules/checklist_items/asset_specs/equipment_types/templates. `viewer`: read-only. Enforced via shared helper `current_role_name()`.

## Cross-project telemetry integration
Overview's "Meter readings" panel reads live from the **separate** telemetry/meter-reading Supabase project via a second client (`sbTelemetry` in `store.js`), anonymous, read-only. Works because that project's `latest_meter_readings`/`meters`/`meter_readings` tables have anonymous-read RLS policies added specifically for this. If a cross-project read ever silently returns `[]`, that's RLS blocking it (Postgres RLS returns empty, not an error) — verify with a raw `fetch()` + apikey header before assuming no data exists. `meter_readings.consumption` is the telemetry app's precomputed per-reading delta; Overview dedupes to the latest row per `meter_id` and shows that, not the raw cumulative counter. Meter icon/color in Overview is a **heuristic** match on `meter_type`/name/unit text (exact `meter_type` enum values on the telemetry side were never confirmed) — tighten this if icons come out wrong.

## Frontend structure
```
/
├── index.html      — SPA shell: header (logo, global "New WO" button, sign-out), tab nav
│                      (Overview / Work Orders / Assets / PMs / Manage), all modals
├── style.css        — dark palette, all component styling, `.ov-*` = Overview-only desktop-dense classes
└── js/
    ├── store.js               — `sb` (CMMS) + `sbTelemetry` (telemetry, read-only) clients, shared `state`,
    │                              toast/loading/format/escape utilities, `priorityMeta()`
    ├── app.js                 — tab switching, global event binding, exposes functions on `window`
    ├── auth.js                 — signIn/signOut/onSignedIn (calls loadOverview() on login)
    ├── assets.js                — asset CRUD incl. class-selection flow on the New Asset form, Asset
    │                              Profile modal (glyph/status/specs rail + Open WO/PM/History tabs),
    │                              asset search dropdown (red dot = has an open breakdown)
    ├── workOrders.js            — WO create/list/filter, WO Detail modal, update flow + wo_visits
    │                              timeline, checklist (check+reading), backdated close times,
    │                              asset-status cache
    ├── schedules.js              — recurring schedule CRUD, checklist items, "Generate WO Now" per schedule
    ├── manage.js                 — Manage tab, two modes: Assets (name/location/department/criticality/
    │                              category/specs — NOT reachable from the Asset Profile modal, by design)
    │                              and Equipment Types (create a class, define its PM template + checklist)
    ├── overview.js               — default landing tab: KPI row, WO queue (priority+age sorted, age
    │                              color-coded), PM due soon, meter readings, recent activity
    ├── assetSpecs.js             — CRUD helpers for asset_specs
    ├── assetGlyphs.js            — SVG glyph-per-category lookup
    └── assetDetailHelpers.js     — getAssetStatus(), getAllWatchItemsForAsset()
```

## Design decisions worth knowing (so they don't get re-litigated)
- **Asset Profile is a modal** (`.asset-modal-box`, max-width 900px) — a full-screen takeover was built and reverted (lost scroll position in the underlying list).
- **WO list is a summary; WO Detail is its own modal** — the list embedding full checklist+timeline per card didn't scale.
- **Specs/category/name/location/department/criticality editing lives ONLY in Manage**, never inline in the Asset Profile modal.
- **PM schedule editing** happens only in the PMs tab — Asset Profile's PM section is view-only with "Edit →".
- **Equipment-class templates are a one-time stamp, not a live link** — see schema section above. This mirrors a real lesson from the project's GAS history.
- **PM-type work orders cannot be created without a schedule selected.**
- **Priority defaults to Normal (P3)** on the New WO form.
- **KPI tiles on Overview were removed once (felt like noise), then reintroduced deliberately with a different, more triage-focused set** (Aging / PM Today / P1-P2 / In Progress rather than a restatement of the table). Don't assume "remove KPIs" is a standing preference — it was about that specific set, not KPIs categorically.
- **Every fix gets logged**, even same-day trivial ones. Backdated close times are real (start/end datetime), not always "now."
- **Multi-project split**: telemetry + meter-reading share one Supabase project; CMMS is separate; Overview reads telemetry read-only across projects.

## Not yet built
- Automatic PM generation on `next_due_at` (manual only, via `generatePmWoNow()` or the New WO form).
- Reminder delivery for `reminder_days_before`.
- Trend view for `wo_checklist_results.result_value` over time.
- Retroactive class assignment / bulk-assign UI (proposed, explicitly deferred — see above).
- Dedicated "all meter readings" / "all activity" pages (an earlier Overview mockup implied footer links to these; skipped since the destinations don't exist).

## Immediate next steps (pick up here)
1. **Get a fresh full repo zip and re-verify against this map** before doing more feature work — this session had several stale-assumption mismatches; start clean.
2. Confirm the `waiting_parts` status constraint and the `assets.department` column are both actually live.
3. Decide + build automatic PM generation and reminder delivery.
4. If meter icons look wrong, get real `meter_type` sample values from the telemetry project and tighten `meterVisual()` in `overview.js`.