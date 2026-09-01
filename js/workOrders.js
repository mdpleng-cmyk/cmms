import { sb, state, toast, setButtonLoading, getLoaderHtml, escapeHtml, formatDate } from './store.js';
import { populateScheduleSelect } from './schedules.js';

export function openNewWoForm() {
  document.getElementById('modal-new-wo').classList.remove('hidden');
  document.getElementById('wo-asset-value').value = '';
  document.getElementById('wo-asset-search').value = '';
  document.getElementById('wo-description').value = '';
  document.getElementById('wo-close-now').checked = false;
  document.getElementById('wo-type').value = 'breakdown';
  document.getElementById('wo-schedule-field').classList.add('hidden');
  
  document.getElementById('wo-type').onchange = (e) => {
    const isPm = e.target.value === 'pm';
    document.getElementById('wo-schedule-field').classList.toggle('hidden', !isPm);
    if (isPm) populateScheduleSelect('wo-schedule');
  };
}

export function closeNewWoForm() { 
  document.getElementById('modal-new-wo').classList.add('hidden'); 
  document.getElementById('wo-asset-dropdown').classList.add('hidden');
}

export async function createWorkOrder() {
  const asset_id = document.getElementById('wo-asset-value').value;
  const type = document.getElementById('wo-type').value;
  const schedule_id = type === 'pm' ? document.getElementById('wo-schedule').value : null;
  const description = document.getElementById('wo-description').value.trim();
  const closeNow = document.getElementById('wo-close-now').checked;

  if (!asset_id) { toast('Please search and select an asset', 'err'); return; }

  setButtonLoading('btn-create-wo', true);
  const payload = {
    asset_id, type, description,
    schedule_id: schedule_id || null,
    created_by: state.currentUser.id,
    status: closeNow ? 'closed' : 'open',
    closed_at: closeNow ? new Date().toISOString() : null
  };

  const { data: wo, error } = await sb.from('work_orders').insert(payload).select().single();
  if (error) { toast(error.message, 'err'); setButtonLoading('btn-create-wo', false); return; }

  if (type === 'pm' && schedule_id) {
    const { data: items } = await sb.from('checklist_items').select('id').eq('schedule_id', schedule_id).eq('active', true);
    if (items && items.length) {
      const rows = items.map(i => ({ wo_id: wo.id, item_id: i.id, done: closeNow }));
      await sb.from('wo_checklist_results').insert(rows);
    }
  }

  toast('Work order created');
  closeNewWoForm();
  setButtonLoading('btn-create-wo', false);
  loadWorkOrders();
}

export async function loadWorkOrders() {
  const list = document.getElementById('wo-list');
  list.innerHTML = getLoaderHtml('Fetching work orders...');
  
  const statuses = document.getElementById('wo-filter').value.split(',');
  const { data, error } = await sb.from('work_orders')
    .select('id, type, status, description, opened_at, closed_at, asset_id, schedule_id, assets(name)')
    .in('status', statuses).order('opened_at', { ascending: false }).limit(50);

  if (error) { list.innerHTML = `<div class="readout-empty">${error.message}</div>`; return; }
  state.activeWorkOrders = data || [];
  renderWorkOrders();
}

function renderWorkOrders() {
  const list = document.getElementById('wo-list');
  if (!state.activeWorkOrders.length) { list.innerHTML = '<div class="readout-empty"><i data-lucide="inbox" style="width:32px;height:32px;"></i> No work orders match.</div>'; lucide.createIcons(); return; }

  list.innerHTML = state.activeWorkOrders.map(wo => `
    <div class="panel wo-card" data-search="${wo.id} ${wo.assets?.name || ''} ${wo.description || ''}".toLowerCase()>
      <div class="row" style="margin-bottom:8px;justify-content:space-between">
        <div style="display:flex; gap:6px;">
          <span class="badge ${wo.type}">${wo.type === 'pm' ? '<i data-lucide="calendar-clock" style="width:12px;"></i>' : '<i data-lucide="wrench" style="width:12px;"></i>'} ${wo.type}</span>
          <span class="badge ${wo.status}">${wo.status.replace('_',' ')}</span>
        </div>
        <span class="card-meta">#${wo.id}</span>
      </div>
      <div class="card-title" style="cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition: opacity 0.2s;" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1" onclick="window.openAssetHistoryModal(${wo.asset_id}, '${escapeHtml(wo.assets?.name || 'Unknown asset').replace(/'/g, "\\'")}')">
        ${escapeHtml(wo.assets?.name || 'Unknown asset')} <i data-lucide="external-link" style="width:14px; color:var(--text-muted);"></i>
      </div>
      <div style="margin:8px 0; font-size:14px; line-height:1.5;">${wo.description ? escapeHtml(wo.description) : '<span class="card-meta">No description provided</span>'}</div>
      <div class="card-meta" style="margin-bottom:12px;">
        <i data-lucide="clock" style="width:12px;display:inline-block;margin-right:2px;vertical-align:middle;"></i> Opened ${formatDate(wo.opened_at)}
        ${wo.closed_at ? `<br><i data-lucide="check-circle-2" style="width:12px;display:inline-block;margin-right:2px;vertical-align:middle;margin-top:4px;"></i> Closed ${formatDate(wo.closed_at)}` : ''}
      </div>
      <div id="checklist-${wo.id}"></div>
      <div class="row" style="margin-top:14px; border-top: 1px solid var(--border); padding-top: 14px;">
        ${wo.status !== 'closed' && (state.currentRole === 'admin' || state.currentRole === 'technician') ? `
          ${wo.status === 'open' ? `<button onclick="window.updateWoStatus(${wo.id},'in_progress')"><i data-lucide="play" style="width:14px;"></i> Start Work</button>` : ''}
          <button class="primary" onclick="window.triggerCloseFlow(${wo.id})"><i data-lucide="check" style="width:14px;"></i> Mark Completed</button>
        ` : ''}
      </div>
    </div>
  `).join('');
  
  lucide.createIcons();
  state.activeWorkOrders.forEach(wo => { if (wo.type === 'pm' && wo.schedule_id) loadChecklistForWo(wo.id); });
}

export function filterWorkOrders() {
  const term = document.getElementById('wo-search').value.toLowerCase();
  document.querySelectorAll('.wo-card').forEach(card => {
    card.style.display = card.dataset.search.includes(term) ? '' : 'none';
  });
}

export async function updateWoStatus(id, status) {
  const { error } = await sb.from('work_orders').update({ status }).eq('id', id);
  if (error) { toast(error.message, 'err'); return; }
  toast('Status updated');
  loadWorkOrders();
}

export function triggerCloseFlow(id) {
  state.woToClose = state.activeWorkOrders.find(w => w.id === id);
  if (!state.woToClose) return;
  document.getElementById('modal-wo-title').innerText = `WO #${state.woToClose.id} - ${state.woToClose.assets?.name}`;
  document.getElementById('modal-wo-notes').value = '';
  document.getElementById('notes-req-star').style.display = (state.woToClose.type === 'breakdown') ? 'inline' : 'none';
  document.getElementById('modal-close-wo').classList.remove('hidden');
}

export function closeModal() { 
  document.getElementById('modal-close-wo').classList.add('hidden'); 
  state.woToClose = null; 
}

export async function confirmCloseWo() {
  if (!state.woToClose) return;
  const notes = document.getElementById('modal-wo-notes').value.trim();
  
  if (state.woToClose.type === 'breakdown' && !notes) {
    toast('Resolution notes are required for breakdowns.', 'err');
    document.getElementById('modal-wo-notes').focus();
    return;
  }
  
  setButtonLoading('btn-confirm-close', true);
  const updatedDescription = notes ? `${state.woToClose.description || ''}\n\n[Resolution]: ${notes}` : state.woToClose.description;
  const { error } = await sb.from('work_orders').update({ status: 'closed', closed_at: new Date().toISOString(), description: updatedDescription }).eq('id', state.woToClose.id);

  if (error) { toast(error.message, 'err'); setButtonLoading('btn-confirm-close', false); return; }
  toast('Work order closed successfully');
  closeModal();
  setButtonLoading('btn-confirm-close', false);
  loadWorkOrders();
}

async function loadChecklistForWo(woId) {
  const { data } = await sb.from('wo_checklist_results').select('id, done, checklist_items(description)').eq('wo_id', woId);
  const box = document.getElementById('checklist-' + woId);
  if (!box || !data || !data.length) return;
  box.innerHTML = `<div style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0 12px; margin-top:12px;">` + 
    data.map(r => `
    <label class="checklist-item ${r.done ? 'done' : ''}" style="cursor:pointer;">
      <input type="checkbox" ${r.done ? 'checked' : ''} ${state.currentRole === 'viewer' ? 'disabled' : ''} onchange="window.toggleChecklistItem(${r.id}, this)">
      <span>${escapeHtml(r.checklist_items.description)}</span>
    </label>
  `).join('') + `</div>`;
}

export async function toggleChecklistItem(resultId, checkboxEl) {
  const done = checkboxEl.checked;
  checkboxEl.closest('label').classList.toggle('done', done);
  await sb.from('wo_checklist_results').update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', resultId);
}
