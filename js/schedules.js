import { sb, state, toast, setButtonLoading, getLoaderHtml, escapeHtml } from './store.js';

const pmGenerationInFlight = new Set();
const pmCompletionHandled = new Set();

export async function openNewScheduleForm() {
  document.getElementById('new-schedule-form').classList.remove('hidden');

  // Fetch assets with their equipment type in one query — fresh, not from cache,
  // so newly added assets/types are always reflected.
  const { data: assets } = await sb
    .from('assets')
    .select('id, name, equipment_type_id, equipment_types(id, name)')
    .order('name');

  // Build: one entry per unique equipment type (classes), then one entry per
  // standalone asset (equipment_type_id IS NULL).
  const typeMap = new Map();   // type_id → type name
  const standalones = [];

  for (const a of (assets || [])) {
    if (a.equipment_type_id != null && a.equipment_types) {
      if (!typeMap.has(a.equipment_type_id)) {
        typeMap.set(a.equipment_type_id, a.equipment_types.name);
      }
    } else if (a.equipment_type_id == null) {
      standalones.push(a);
    }
  }

  // Types sorted alphabetically, then standalones (already name-ordered from DB).
  const sortedTypes = [...typeMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const options = [
    ...sortedTypes.map(([id, name]) => `<option value="type:${id}">${escapeHtml(name)}</option>`),
    ...standalones.map(a => `<option value="asset:${a.id}">${escapeHtml(a.name)}</option>`),
  ];

  document.getElementById('sched-asset').innerHTML =
    options.length ? options.join('') : '<option value="">No assets available</option>';

  // Set initial field state to match the first option.
  onPmTargetChange();
}

export function closeNewScheduleForm() { document.getElementById('new-schedule-form').classList.add('hidden'); }

// Called by onchange on #sched-asset. Disables the date picker and shows a note
// when an equipment-type (class) target is selected, because the due date is
// calculated automatically per asset.
// This also shows a preview of which assets will
// receive schedules.
export async function onPmTargetChange() {
  const val      = document.getElementById('sched-asset').value;
  const dueInput = document.getElementById('sched-due');
  const dueNote  = document.getElementById('sched-due-note');
  const preview  = document.getElementById('sched-target-preview');
  const isClass  = val.startsWith('type:');
  dueInput.disabled = isClass;
  if (isClass) {
    dueInput.value = '';
    dueNote.classList.remove('hidden');

    // Show asset preview for this class.
    const typeId = parseInt(val.slice(5), 10);
    preview.innerHTML = 'Loading assets…';
    preview.classList.remove('hidden');
    const { data: assets } = await sb.from('assets').select('name').eq('equipment_type_id', typeId).order('name');
    if (assets && assets.length) {
      preview.innerHTML = `<strong>Schedules will be created for ${assets.length} asset${assets.length !== 1 ? 's' : ''}:</strong> ` +
        assets.map(a => escapeHtml(a.name)).join(', ');
    } else {
      preview.innerHTML = 'No assets found for this equipment type.';
    }
  } else {
    dueNote.classList.add('hidden');
    preview.classList.add('hidden');
    preview.innerHTML = '';
  }
}

export async function createSchedule() {
  const targetValue   = document.getElementById('sched-asset').value;
  const title         = document.getElementById('sched-title').value.trim();
  const interval_days = parseInt(document.getElementById('sched-interval').value, 10);

  if (!targetValue || !title || !interval_days) { toast('Fill all required fields', 'err'); return; }

  // ── Standalone asset path ─────────────────────────────────────────────────
  // Value is "asset:<id>" (new form) or a plain id (defensive fallback).
  if (!targetValue.startsWith('type:')) {
    const asset_id    = targetValue.startsWith('asset:') ? targetValue.slice(6) : targetValue;
    const next_due_at = document.getElementById('sched-due').value;
    if (!next_due_at) { toast('Fill all required fields', 'err'); return; }

    setButtonLoading('btn-create-schedule', true);
    const { error } = await sb.from('recurring_schedules').insert({ asset_id, title, interval_days, next_due_at });
    if (error) { toast(error.message, 'err'); setButtonLoading('btn-create-schedule', false); return; }

    toast('Schedule created');
    closeNewScheduleForm();
    document.getElementById('sched-title').value = '';
    setButtonLoading('btn-create-schedule', false);
    loadSchedules();
    return;
  }

  // ── Equipment-type (class) path ───────────────────────────────────────────
  const type_id = parseInt(targetValue.slice(5), 10);

  // 1. Fetch every asset belonging to this equipment type.
  const { data: assets, error: assetsErr } = await sb
    .from('assets')
    .select('id, name, created_at')
    .eq('equipment_type_id', type_id)
    .order('name');

  if (assetsErr) { toast(assetsErr.message, 'err'); return; }
  if (!assets || !assets.length) { toast('No assets found for this equipment type', 'err'); return; }

  // 2. Bulk-check for duplicates.
  // Duplicate rule:
  // - same asset (asset_id)
  // - same PM title (title)
  // - same interval_days
  // Checklist differences are NOT considered.
  const assetIds = assets.map(a => a.id);
  const { data: existing } = await sb
    .from('recurring_schedules')
    .select('asset_id')
    .in('asset_id', assetIds)
    .eq('title', title)
    .eq('interval_days', interval_days);

  const alreadyHave = new Set((existing || []).map(s => s.asset_id));
  const toCreate    = assets.filter(a => !alreadyHave.has(a.id));
  const skipped     = assets.length - toCreate.length;

  if (!toCreate.length) {
    toast(`0 schedules created, ${skipped} skipped (already exist)`);
    return;
  }

  // 3. Build insert rows. next_due_at = created_at::date + interval_days,
  //    matching the stamp trigger rule. UTC date is used to align with the
  //    Postgres ::date cast (Supabase default timezone is UTC).
  const rows = toCreate.map(asset => {
    const c   = new Date(asset.created_at);
    const y   = c.getUTCFullYear();
    const mo  = String(c.getUTCMonth() + 1).padStart(2, '0');
    const d   = String(c.getUTCDate()).padStart(2, '0');
    const base = new Date(`${y}-${mo}-${d}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + interval_days);
    return { asset_id: asset.id, title, interval_days, next_due_at: base.toISOString().slice(0, 10) };
  });

  setButtonLoading('btn-create-schedule', true);
  const { error: insertErr } = await sb.from('recurring_schedules').insert(rows);
  if (insertErr) { toast(insertErr.message, 'err'); setButtonLoading('btn-create-schedule', false); return; }

  // 4. Report result.
  const created = toCreate.length;
  const parts   = [`${created} schedule${created !== 1 ? 's' : ''} created`];
  if (skipped) parts.push(`${skipped} skipped (already exist${skipped !== 1 ? '' : 's'})`);
  toast(parts.join(', '));

  closeNewScheduleForm();
  document.getElementById('sched-title').value = '';
  setButtonLoading('btn-create-schedule', false);
  loadSchedules();
}

export async function loadSchedules() {
  const list = document.getElementById('schedule-list');
  list.innerHTML = getLoaderHtml('Loading schedules...');
  
  const { data, error } = await sb.from('recurring_schedules').select('id, title, interval_days, next_due_at, active, asset_id, assets(name, equipment_types(name))').order('next_due_at');
  state.schedulesCache = data || [];
  
  if (error) { list.innerHTML = `<div class="readout-empty">${error.message}</div>`; return; }
  if (!state.schedulesCache.length) { list.innerHTML = '<div class="readout-empty"><i data-lucide="calendar-clock" style="width:32px;height:32px;"></i> No PM schedules yet.</div>'; lucide.createIcons(); return; }

  list.innerHTML = state.schedulesCache.map(s => {
    const typeName = s.assets?.equipment_types?.name;
    return `
    <div class="panel" id="schedule-card-${s.id}">
      <div class="row" style="justify-content:space-between; margin-bottom:2px;">
        <div class="card-title" style="margin:0;">${escapeHtml(s.title)}</div>
        ${state.currentRole !== 'viewer' ? `<button class="ghost" style="padding:4px 8px; font-size:11px; border:1px solid var(--border);" onclick="window.generatePmWoNow(${s.id})"><i data-lucide="zap" style="width:12px;"></i> Generate WO Now</button>` : ''}
      </div>
      <div class="card-meta">
        <i data-lucide="server" style="width:12px; display:inline-block; vertical-align:-2px;"></i> ${s.assets?.name || ''} &middot; 
        <i data-lucide="server" style="width:12px; display:inline-block; vertical-align:-2px;"></i> ${s.assets?.name || ''}${typeName ? ` <span class="badge" style="font-size:9px; vertical-align:1px;">${escapeHtml(typeName)}</span>` : ''} &middot; 
        <i data-lucide="rotate-cw" style="width:12px; display:inline-block; vertical-align:-2px;"></i> ${s.interval_days}d &middot; 
        Due: ${s.next_due_at}
      </div>
      <div id="items-${s.id}" style="margin-top:12px"></div>
      ${state.currentRole !== 'viewer' ? `
        <div class="row" style="margin-top:12px">
          <input id="new-item-${s.id}" placeholder="Add checklist item..." style="flex:1;">
          <select id="new-item-type-${s.id}" style="width:auto;" onchange="window.toggleNewItemUnit(${s.id})">
            <option value="check">Check</option>
            <option value="reading">Reading</option>
          </select>
          <input id="new-item-unit-${s.id}" placeholder="unit" style="width:64px; display:none;">
          <button class="ghost" onclick="window.addChecklistItem(${s.id})" style="border:1px solid var(--border);"><i data-lucide="plus" style="width:14px;"></i></button>
        </div>` : ''}
    </div>
  `;
  }).join('');
  lucide.createIcons();
  for (const s of state.schedulesCache) loadChecklistItems(s.id);
}

export async function loadChecklistItems(scheduleId) {
  const { data } = await sb.from('checklist_items').select('id, description, item_type, unit').eq('schedule_id', scheduleId).eq('active', true).order('added_at');
  const box = document.getElementById('items-' + scheduleId);
  if (!box) return;
  if (!data || !data.length) { box.innerHTML = '<div class="card-meta">No checklist tasks defined.</div>'; return; }
  box.innerHTML = data.map(i => `<div class="checklist-item"><i data-lucide="${i.item_type === 'reading' ? 'gauge' : 'minus'}" style="width:12px; color:var(--text-muted); margin-top:2px;"></i> ${escapeHtml(i.description)}${i.item_type === 'reading' ? ` <span class="card-meta">(${escapeHtml(i.unit)})</span>` : ''}</div>`).join('');
  lucide.createIcons({ root: box });
}

export function toggleNewItemUnit(scheduleId) {
  const isReading = document.getElementById('new-item-type-' + scheduleId).value === 'reading';
  document.getElementById('new-item-unit-' + scheduleId).style.display = isReading ? '' : 'none';
}

export async function addChecklistItem(scheduleId) {
  const input = document.getElementById('new-item-' + scheduleId);
  const description = input.value.trim();
  if (!description) return;
  const item_type = document.getElementById('new-item-type-' + scheduleId).value;
  const unitInput = document.getElementById('new-item-unit-' + scheduleId);
  const unit = item_type === 'reading' ? unitInput.value.trim() : null;
  if (item_type === 'reading' && !unit) { toast('Enter a unit for readings (e.g. bar, °C)', 'err'); return; }
  const { error } = await sb.from('checklist_items').insert({ schedule_id: scheduleId, description, item_type, unit });
  if (error) { toast(error.message, 'err'); return; }
  input.value = '';
  unitInput.value = '';
  loadChecklistItems(scheduleId);
}

export function populateScheduleSelect(id) {
  const assetId = document.getElementById('wo-asset-value').value;
  const sel = document.getElementById(id);
  if (!assetId) { sel.innerHTML = '<option value="">Select an asset first</option>'; return; }
  
  sb.from('recurring_schedules').select('id, title').eq('asset_id', assetId).eq('active', true).then(({ data }) => {
    sel.innerHTML = (data && data.length) 
      ? data.map(s => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join('')
      : '<option value="">No PM schedules for this asset</option>';
  });
}

export async function advanceScheduleForCompletedPm(scheduleId, completedAt, completionKey) {
  if (!completedAt || Number.isNaN(new Date(completedAt).getTime())) {
    return { error: new Error('PM completion timestamp is required') };
  }
  if (completionKey && pmCompletionHandled.has(completionKey)) {
    return { error: null, alreadyHandled: true };
  }
  if (completionKey) pmCompletionHandled.add(completionKey);

  const { data: schedule, error: loadErr } = await sb.from('recurring_schedules')
    .select('id, interval_days')
    .eq('id', scheduleId)
    .single();
  if (loadErr) {
    if (completionKey) pmCompletionHandled.delete(completionKey);
    return { error: loadErr };
  }

  const nextDue = new Date(completedAt);
  nextDue.setUTCDate(nextDue.getUTCDate() + schedule.interval_days);
  const nextDueValue = nextDue.toISOString();
  const { error: updateErr } = await sb.from('recurring_schedules')
    .update({ next_due_at: nextDueValue })
    .eq('id', scheduleId);
  if (updateErr) {
    if (completionKey) pmCompletionHandled.delete(completionKey);
    return { error: updateErr };
  }

  const { data: updated, error: verifyErr } = await sb.from('recurring_schedules')
    .select('id, next_due_at')
    .eq('id', scheduleId)
    .single();
  if (verifyErr) {
    if (completionKey) pmCompletionHandled.delete(completionKey);
    return { error: verifyErr };
  }
  if (new Date(updated.next_due_at).getTime() !== nextDue.getTime()) {
    if (completionKey) pmCompletionHandled.delete(completionKey);
    return { error: new Error('Schedule due date did not change') };
  }

  {
    const cached = state.schedulesCache.find(item => item.id === scheduleId);
    if (cached) cached.next_due_at = nextDueValue;
  }
  return { error: null, next_due_at: nextDueValue };
}

export async function generatePmWoNow(scheduleId) {
  const schedule = state.schedulesCache.find(s => s.id === scheduleId);
  if (!schedule) { toast('Schedule not found', 'err'); return; }
  if (pmGenerationInFlight.has(scheduleId)) return;
  pmGenerationInFlight.add(scheduleId);

  try {
    const { data, error } = await sb.rpc('generate_pm_work_order', { p_schedule_id: scheduleId });
    if (error) { toast(error.message, 'err'); return; }
    const wo = Array.isArray(data) ? data[0] : data;
    if (!wo?.wo_id) { toast('PM work order generation returned no work order', 'err'); return; }

    toast('PM work order generated');
    window.switchTab('wo');
    window.openWoDetailModal(wo.wo_id);
  } finally {
    pmGenerationInFlight.delete(scheduleId);
  }
}
