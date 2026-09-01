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
    <div class="panel">
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
          <button class="ghost" onclick="window.addChecklistItem(${s.id})" style="border:1px solid var(--border);"><i data-lucide="plus" style="width:14px;"></i></button>
        </div>` : ''}
    </div>
  `).join('');
  lucide.createIcons();
  for (const s of state.schedulesCache) loadChecklistItems(s.id);
}

export async function loadChecklistItems(scheduleId) {
  const { data } = await sb.from('checklist_items').select('id, description').eq('schedule_id', scheduleId).eq('active', true).order('added_at');
  const box = document.getElementById('items-' + scheduleId);
  if (!box) return;
  if (!data || !data.length) { box.innerHTML = '<div class="card-meta">No checklist tasks defined.</div>'; return; }
  box.innerHTML = data.map(i => `<div class="checklist-item"><i data-lucide="minus" style="width:12px; color:var(--text-muted); margin-top:2px;"></i> ${escapeHtml(i.description)}</div>`).join('');
  lucide.createIcons({ root: box });
}

export async function addChecklistItem(scheduleId) {
  const input = document.getElementById('new-item-' + scheduleId);
  const description = input.value.trim();
  if (!description) return;
  const { error } = await sb.from('checklist_items').insert({ schedule_id: scheduleId, description });
  if (error) { toast(error.message, 'err'); return; }
  input.value = '';
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
