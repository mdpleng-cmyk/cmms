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
    <div class="panel wo-card" style="cursor:pointer;" data-search="${wo.id} ${wo.assets?.name || ''} ${wo.description || ''}".toLowerCase() onclick="window.openWoDetailModal(${wo.id})">
      <div class="row" style="margin-bottom:8px;justify-content:space-between">
        <div style="display:flex; gap:6px;">
          <span class="badge ${wo.type}">${wo.type === 'pm' ? '<i data-lucide="calendar-clock" style="width:12px;"></i>' : '<i data-lucide="wrench" style="width:12px;"></i>'} ${wo.type}</span>
          <span class="badge ${wo.status}">${wo.status.replace('_',' ')}</span>
        </div>
        <span class="card-meta">#${wo.id}</span>
      </div>
      <div class="card-title">${escapeHtml(wo.assets?.name || 'Unknown asset')}</div>
      <div style="margin:6px 0; font-size:13.5px; line-height:1.5; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${wo.description ? escapeHtml(wo.description) : 'No description provided'}</div>
      <div class="card-meta"><i data-lucide="clock" style="width:12px;display:inline-block;margin-right:2px;vertical-align:middle;"></i> Opened ${formatDate(wo.opened_at)}</div>
    </div>
  `).join('');
  
  lucide.createIcons();
}

export async function openWoDetailModal(id) {
  let wo = state.activeWorkOrders.find(w => w.id === id);
  if (!wo) {
    const { data } = await sb.from('work_orders').select('id, type, status, description, opened_at, closed_at, asset_id, schedule_id, assets(name)').eq('id', id).single();
    wo = data;
  }
  if (!wo) { toast('Work order not found', 'err'); return; }
  state.woDetailCurrent = wo;

  document.getElementById('wo-detail-header').innerHTML = `
    <div class="row" style="margin:8px 0;justify-content:space-between">
      <div style="display:flex; gap:6px;">
        <span class="badge ${wo.type}">${wo.type}</span>
        <span class="badge ${wo.status}">${wo.status.replace('_',' ')}</span>
      </div>
      <span class="card-meta">#${wo.id}</span>
    </div>
    <div class="card-title" style="cursor:pointer; display:inline-flex; align-items:center; gap:6px;" onclick="window.closeWoDetailModal(); window.openAssetHistoryModal(${wo.asset_id}, '${escapeHtml(wo.assets?.name || 'Unknown asset').replace(/'/g, "\\'")}')">
      ${escapeHtml(wo.assets?.name || 'Unknown asset')} <i data-lucide="external-link" style="width:14px; color:var(--text-muted);"></i>
    </div>
    <div style="margin:8px 0; font-size:14px; line-height:1.5;">${wo.description ? escapeHtml(wo.description) : '<span class="card-meta">No description provided</span>'}</div>
    <div class="card-meta">
      <i data-lucide="clock" style="width:12px;display:inline-block;margin-right:2px;vertical-align:middle;"></i> Opened ${formatDate(wo.opened_at)}
      ${wo.closed_at ? `<br><i data-lucide="check-circle-2" style="width:12px;display:inline-block;margin-right:2px;vertical-align:middle;margin-top:4px;"></i> Closed ${formatDate(wo.closed_at)}` : ''}
    </div>
  `;

  document.getElementById('wo-detail-update-btn').classList.toggle('hidden',
    !(wo.status !== 'closed' && (state.currentRole === 'admin' || state.currentRole === 'technician')));

  document.getElementById('modal-wo-detail').classList.remove('hidden');

  if (wo.type === 'pm' && wo.schedule_id) loadChecklistForWo(wo.id);
  else document.getElementById('wo-detail-checklist').classList.add('hidden');
  loadVisitsForWo(wo.id);

  lucide.createIcons({ root: document.getElementById('modal-wo-detail') });
}

export function closeWoDetailModal() {
  document.getElementById('modal-wo-detail').classList.add('hidden');
  state.woDetailCurrent = null;
}

export function triggerUpdateFromDetail() {
  if (state.woDetailCurrent) triggerUpdateFlow(state.woDetailCurrent.id);
}

async function loadVisitsForWo(woId) {
  const box = document.getElementById('wo-detail-visits');
  box.innerHTML = getLoaderHtml('Loading activity...');
  const { data } = await sb.from('wo_visits')
    .select('visit_type, action_taken, parts_used, technician, visited_at')
    .eq('wo_id', woId)
    .order('visited_at', { ascending: false });
  if (!data || !data.length) { box.innerHTML = '<div class="card-meta">No updates logged yet.</div>'; return; }
  box.innerHTML = data.map(v => `
    <div class="activity-entry">
      <span class="activity-date">${formatDate(v.visited_at).split(',')[0]}</span>
      <div class="activity-body">
        <p class="activity-title">${v.visit_type.replace('_',' ')}${v.technician ? ' \u00b7 ' + escapeHtml(v.technician) : ''}</p>
        ${v.action_taken ? `<p class="activity-meta">${escapeHtml(v.action_taken)}</p>` : ''}
        ${v.parts_used ? `<p class="activity-meta">Parts: ${escapeHtml(v.parts_used)}</p>` : ''}
      </div>
    </div>
  `).join('');
}

export function filterWorkOrders() {
  const term = document.getElementById('wo-search').value.toLowerCase();
  document.querySelectorAll('.wo-card').forEach(card => {
    card.style.display = card.dataset.search.includes(term) ? '' : 'none';
  });
}

export function triggerUpdateFlow(id) {
  state.woToUpdate = state.activeWorkOrders.find(w => w.id === id) || (state.woDetailCurrent?.id === id ? state.woDetailCurrent : null);
  if (!state.woToUpdate) return;
  
  document.getElementById('modal-wo-title').innerText = `WO #${state.woToUpdate.id} - ${state.woToUpdate.assets?.name}`;
  document.getElementById('modal-wo-original-desc').innerText = state.woToUpdate.description || "No initial description provided.";
  
  document.getElementById('modal-wo-notes').value = '';
  document.getElementById('modal-wo-parts').value = '';
  document.getElementById('modal-wo-technician').value = '';
  document.getElementById('toggle-spare').checked = false;
  document.getElementById('toggle-close').checked = false;
  
  document.getElementById('notes-req-star').style.display = (state.woToUpdate.type === 'breakdown') ? 'inline' : 'none';
  
  document.getElementById('update-step-input').classList.remove('hidden');
  document.getElementById('update-step-confirm').classList.add('hidden');
  document.getElementById('modal-update-wo').classList.remove('hidden');
}

export function closeUpdateModal() {
  document.getElementById('modal-update-wo').classList.add('hidden');
  state.woToUpdate = null;
}

export function reviewUpdateWo() {
  const note = document.getElementById('modal-wo-notes').value.trim();
  const parts = document.getElementById('modal-wo-parts').value.trim();
  const technician = document.getElementById('modal-wo-technician').value.trim();
  const isClosed = document.getElementById('toggle-close').checked;
  const isWaiting = document.getElementById('toggle-spare').checked;
  
  if (isClosed && state.woToUpdate.type === 'breakdown' && !note) {
    toast('Resolution notes are required to close a breakdown.', 'err');
    document.getElementById('modal-wo-notes').focus();
    return;
  }

  let newStatus = state.woToUpdate.status;
  let visitType = 'update';
  if (isClosed) { newStatus = 'closed'; visitType = 'closed'; }
  else if (isWaiting) { newStatus = 'waiting_parts'; visitType = 'awaiting_spares'; }
  else if (note) { newStatus = 'in_progress'; }

  document.getElementById('confirm-status-badge').innerText = newStatus.replace('_', ' ').toUpperCase();
  document.getElementById('confirm-note-preview').innerText =
    (note || parts || technician)
      ? [note, parts && `Parts: ${parts}`, technician && `Technician: ${technician}`].filter(Boolean).join('\n')
      : "No visit details provided.";

  state.woToUpdate.pendingStatus = newStatus;
  state.woToUpdate.pendingVisitType = visitType;
  state.woToUpdate.pendingNote = note;
  state.woToUpdate.pendingParts = parts;
  state.woToUpdate.pendingTechnician = technician;

  document.getElementById('update-step-input').classList.add('hidden');
  document.getElementById('update-step-confirm').classList.remove('hidden');
  lucide.createIcons();
}

export function backToEditWo() {
  document.getElementById('update-step-confirm').classList.add('hidden');
  document.getElementById('update-step-input').classList.remove('hidden');
}

export async function confirmSaveWo() {
  setButtonLoading('btn-confirm-save', true);
  const wo = state.woToUpdate;
  const newStatus = wo.pendingStatus;

  const payload = { status: newStatus };
  if (newStatus === 'closed') payload.closed_at = new Date().toISOString();

  const { error } = await sb.from('work_orders').update(payload).eq('id', wo.id);
  if (error) { toast(error.message, 'err'); setButtonLoading('btn-confirm-save', false); return; }

  if (wo.pendingNote || wo.pendingParts || wo.pendingTechnician) {
    const { error: visitErr } = await sb.from('wo_visits').insert({
      wo_id: wo.id,
      visit_type: wo.pendingVisitType,
      action_taken: wo.pendingNote || null,
      parts_used: wo.pendingParts || null,
      technician: wo.pendingTechnician || null,
      logged_by: state.currentUser.id,
    });
    if (visitErr) toast('Status saved, but visit record failed: ' + visitErr.message, 'err');
  }

  toast('Work order updated successfully');
  closeUpdateModal();
  setButtonLoading('btn-confirm-save', false);
  loadWorkOrders();
  if (state.woDetailCurrent && state.woDetailCurrent.id === wo.id) openWoDetailModal(wo.id);
}

async function loadChecklistForWo(woId) {
  const box = document.getElementById('wo-detail-checklist');
  const { data } = await sb.from('wo_checklist_results')
    .select('id, done, result_value, checklist_items(description, item_type, unit)')
    .eq('wo_id', woId);
  if (!box) return;
  if (!data || !data.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const readOnly = state.currentRole === 'viewer';
  box.innerHTML = `<div class="eyebrow" style="margin:14px 0 8px;">Checklist</div><div style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0 12px;">` +
    data.map(r => {
      const item = r.checklist_items;
      if (item.item_type === 'reading') {
        return `
        <div class="checklist-item">
          <span style="flex:1;">${escapeHtml(item.description)}</span>
          <input type="number" step="any" value="${r.result_value ?? ''}" placeholder="value" style="width:80px;"
            ${readOnly ? 'disabled' : ''} onchange="window.saveReadingValue(${r.id}, this)">
          <span class="card-meta" style="margin-left:4px;">${escapeHtml(item.unit || '')}</span>
        </div>`;
      }
      return `
      <label class="checklist-item ${r.done ? 'done' : ''}" style="cursor:pointer;">
        <input type="checkbox" ${r.done ? 'checked' : ''} ${readOnly ? 'disabled' : ''} onchange="window.toggleChecklistItem(${r.id}, this)">
        <span>${escapeHtml(item.description)}</span>
      </label>`;
    }).join('') + `</div>`;
}

export async function toggleChecklistItem(resultId, checkboxEl) {
  const done = checkboxEl.checked;
  checkboxEl.closest('label').classList.toggle('done', done);
  await sb.from('wo_checklist_results').update({ done, result_check: done, done_at: done ? new Date().toISOString() : null }).eq('id', resultId);
}

export async function saveReadingValue(resultId, inputEl) {
  const raw = inputEl.value.trim();
  const value = raw === '' ? null : parseFloat(raw);
  await sb.from('wo_checklist_results').update({ result_value: value, done: value !== null, done_at: value !== null ? new Date().toISOString() : null }).eq('id', resultId);
}
