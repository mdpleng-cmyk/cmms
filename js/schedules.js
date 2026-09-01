import { sb, state, toast, setButtonLoading, getLoaderHtml, escapeHtml } from './store.js';

export function openNewScheduleForm() {
  document.getElementById('new-schedule-form').classList.remove('hidden');
  document.getElementById('sched-asset').innerHTML = state.assetsCache.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
}
export function closeNewScheduleForm() { document.getElementById('new-schedule-form').classList.add('hidden'); }

export async function createSchedule() {
  const asset_id = document.getElementById('sched-asset').value;
  const title = document.getElementById('sched-title').value.trim();
  const interval_days = parseInt(document.getElementById('sched-interval').value, 10);
  const next_due_at = document.getElementById('sched-due').value;

  if (!asset_id || !title || !interval_days || !next_due_at) { toast('Fill all required fields', 'err'); return; }

  setButtonLoading('btn-create-schedule', true);
  const { error } = await sb.from('recurring_schedules').insert({ asset_id, title, interval_days, next_due_at });
  if (error) { toast(error.message, 'err'); setButtonLoading('btn-create-schedule', false); return; }
  
  toast('Schedule created');
  closeNewScheduleForm();
  document.getElementById('sched-title').value = '';
  setButtonLoading('btn-create-schedule', false);
  loadSchedules();
}

export async function loadSchedules() {
  const list = document.getElementById('schedule-list');
  list.innerHTML = getLoaderHtml('Loading schedules...');
  
  const { data, error } = await sb.from('recurring_schedules').select('id, title, interval_days, next_due_at, active, assets(name)').order('next_due_at');
  state.schedulesCache = data || [];
  
  if (error) { list.innerHTML = `<div class="readout-empty">${error.message}</div>`; return; }
  if (!state.schedulesCache.length) { list.innerHTML = '<div class="readout-empty"><i data-lucide="calendar-clock" style="width:32px;height:32px;"></i> No PM schedules yet.</div>'; lucide.createIcons(); return; }

  list.innerHTML = state.schedulesCache.map(s => `
    <div class="panel" id="schedule-card-${s.id}">
      <div class="card-title">${escapeHtml(s.title)}</div>
      <div class="card-meta">
        <i data-lucide="server" style="width:12px; display:inline-block; vertical-align:-2px;"></i> ${s.assets?.name || ''} &middot; 
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
  `).join('');
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
