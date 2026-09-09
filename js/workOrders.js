import { sb, state, toast, setButtonLoading, getLoaderHtml, escapeHtml, formatDate, priorityMeta } from './store.js';
import { loadOverview } from './overview.js';
import { loadSchedules, advanceScheduleForCompletedPm } from './schedules.js';

let noAssetSelected = false;
let noAssetWarningOpen = false;
let createdWoConfirmation = null;

export function openNewWoForm() {
  document.getElementById('modal-new-wo').classList.remove('hidden');
  document.getElementById('wo-create-form-content').classList.remove('hidden');
  document.getElementById('wo-create-success').classList.add('hidden');
  createdWoConfirmation = null;
  document.getElementById('wo-asset-value').value = '';
  document.getElementById('wo-asset-search').value = '';
  document.getElementById('wo-description').value = '';
  document.getElementById('wo-close-now').checked = false;
  document.getElementById('wo-close-times').classList.add('hidden');
  document.getElementById('wo-close-details').classList.add('hidden');
  document.getElementById('wo-start-time').value = '';
  document.getElementById('wo-end-time').value = '';
  document.getElementById('wo-close-notes').value = '';
  document.getElementById('wo-close-parts').value = '';
  document.getElementById('wo-close-technician').value = '';
  document.getElementById('wo-type').value = 'breakdown';
  document.getElementById('wo-priority').value = 'P3';
  document.getElementById('wo-planned-date').value = '';
  document.getElementById('wo-planned-date-field').classList.add('hidden');
  document.getElementById('wo-planned-date-toggle').classList.remove('hidden');
  noAssetSelected = false;
  noAssetWarningOpen = false;
  document.getElementById('wo-no-asset-warning').classList.add('hidden');

  refreshAssetStatusCache();
}

export function toggleWoCloseTimes(checked) {
  document.getElementById('wo-close-times').classList.toggle('hidden', !checked);
  document.getElementById('wo-close-details').classList.toggle('hidden', !checked);
  if (checked) {
    const startEl = document.getElementById('wo-start-time');
    const endEl = document.getElementById('wo-end-time');
    if (!startEl.value) startEl.value = toDatetimeLocalValue(new Date());
    if (!endEl.value) endEl.value = toDatetimeLocalValue(new Date());
  }
}

export function togglePlannedDateField(which) {
  const toggleEl = document.getElementById(which + '-planned-date-toggle');
  const fieldEl = document.getElementById(which + '-planned-date-field');
  fieldEl.classList.remove('hidden');
  toggleEl.classList.add('hidden');
}

function toDatetimeLocalValue(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function openNewWoFormForAsset(assetId, assetName) {
  openNewWoForm();
  window.selectAsset(assetId, assetName);
}

export function raiseWoFromAssetPage() {
  const current = state.assetPageCurrent;
  if (!current) return;
  window.closeAssetHistoryModal();
  openNewWoFormForAsset(current.id, current.name);
}

// Populated once per form-open (not per keystroke) — cheap single query,
// used only to show a "has an open breakdown" dot in the asset dropdown.
async function refreshAssetStatusCache() {
  const { data } = await sb.from('work_orders').select('asset_id, type').in('status', ['open','in_progress','waiting_parts']);
  const cache = {};
  (data || []).forEach(w => {
    if (w.asset_id == null) return;
    cache[w.asset_id] = cache[w.asset_id] || { hasBreakdown: false };
    if (w.type === 'breakdown') cache[w.asset_id].hasBreakdown = true;
  });
  state.assetStatusCache = cache;
}

export function closeNewWoForm() { 
  document.getElementById('modal-new-wo').classList.add('hidden'); 
  document.getElementById('wo-asset-dropdown').classList.add('hidden');
  document.getElementById('wo-no-asset-warning').classList.add('hidden');
}

export function logWithoutAsset() {
  noAssetSelected = true;
  document.getElementById('wo-asset-value').value = '';
  document.getElementById('wo-asset-search').value = 'No asset';
  document.getElementById('wo-asset-dropdown').classList.add('hidden');
}

export function clearNoAssetSelection() {
  noAssetSelected = false;
}

export function cancelNoAssetWarning() {
  noAssetWarningOpen = false;
  document.getElementById('wo-no-asset-warning').classList.add('hidden');
}

export function continueWithoutAsset() {
  noAssetWarningOpen = false;
  document.getElementById('wo-no-asset-warning').classList.add('hidden');
  createWorkOrder(true);
}

async function rollbackCreatedWorkOrder(woId) {
  await sb.from('wo_checklist_results').delete().eq('wo_id', woId);
  await sb.from('wo_visits').delete().eq('wo_id', woId);
  await sb.from('work_orders').delete().eq('id', woId);
}

export async function createWorkOrder(skipNoAssetWarning = false) {
  const planned_date = document.getElementById('wo-planned-date').value || null;
  const asset_id = document.getElementById('wo-asset-value').value || null;
  const type = document.getElementById('wo-type').value;
  const description = document.getElementById('wo-description').value.trim();
  const closeNow = document.getElementById('wo-close-now').checked;
  const priority = document.getElementById('wo-priority').value || null;

  if (!asset_id && !noAssetSelected) { toast('Please search and select an asset, or choose Log without an asset', 'err'); return; }
  if (!asset_id && !skipNoAssetWarning) {
    noAssetWarningOpen = true;
    document.getElementById('wo-no-asset-warning').classList.remove('hidden');
    return;
  }

  let openedAt = new Date().toISOString();
  let closedAt = closeNow ? new Date().toISOString() : null;
  let closeNotes = '', closeParts = '', closeTechnician = '';

  if (closeNow) {
    const startVal = document.getElementById('wo-start-time').value;
    const endVal = document.getElementById('wo-end-time').value;
    if (!startVal || !endVal) { toast('Enter both start and end time', 'err'); return; }
    const start = new Date(startVal);
    const end = new Date(endVal);
    if (end < start) { toast('End time cannot be before start time', 'err'); return; }
    openedAt = start.toISOString();
    closedAt = end.toISOString();

    closeNotes = document.getElementById('wo-close-notes').value.trim();
    closeParts = document.getElementById('wo-close-parts').value.trim();
    closeTechnician = document.getElementById('wo-close-technician').value.trim();
    if (type === 'breakdown' && !closeNotes) { toast('Action taken is required to log a completed breakdown.', 'err'); return; }
  }

  setButtonLoading('btn-create-wo', true);
  const payload = {
    asset_id, type, description, priority, planned_date,
    schedule_id: null,
    created_by: state.currentUser.id,
    status: closeNow ? 'closed' : 'open',
    opened_at: openedAt,
    closed_at: closedAt
  };

  const { data: wo, error } = await sb.from('work_orders')
    .insert(payload)
    .select('id, asset_id, type, status, description, priority, opened_at, closed_at, assets(name)')
    .single();
  if (error) { toast(error.message, 'err'); setButtonLoading('btn-create-wo', false); return; }

  if (closeNow) {
    const { error: visitErr } = await sb.from('wo_visits').insert({
      wo_id: wo.id,
      visit_type: 'closed',
      action_taken: closeNotes || null,
      parts_used: closeParts || null,
      technician: closeTechnician || null,
      logged_by: state.currentUser.id,
      visited_at: closedAt,
    });
    if (visitErr) {
      await rollbackCreatedWorkOrder(wo.id);
      toast('Work order was not completed: ' + visitErr.message, 'err');
      setButtonLoading('btn-create-wo', false);
      return;
    }
  }

  createdWoConfirmation = wo;
  renderCreatedWoConfirmation(wo);
  toast('Work order created');
  loadOverview();
  setButtonLoading('btn-create-wo', false);
  loadWorkOrders();
}

function renderCreatedWoConfirmation(wo) {
  const assetName = wo.asset_id == null ? 'No asset' : (wo.assets?.name || 'Unknown asset');
  const typeName = wo.type === 'breakdown' ? 'Breakdown / Fix' : wo.type === 'other' ? 'Other' : wo.type;
  const timingRows = wo.status === 'closed'
    ? `<div><dt>Started</dt><dd>${formatDate(wo.opened_at)}</dd></div>
       <div><dt>Finished</dt><dd>${formatDate(wo.closed_at)}</dd></div>`
    : `<div><dt>Created</dt><dd>${formatDate(wo.opened_at)}</dd></div>`;
  const successEl = document.getElementById('wo-create-success');
  successEl.innerHTML = `
    <div class="eyebrow">Work Order Created</div>
    <div class="wo-create-success-id">WO #${wo.id}</div>
    ${wo.description ? `<div class="wo-create-success-description">${escapeHtml(wo.description)}</div>` : ''}
    <dl class="wo-create-success-details">
      <div><dt>Asset</dt><dd>${escapeHtml(assetName)}</dd></div>
      <div><dt>Type</dt><dd>${escapeHtml(typeName)}</dd></div>
      <div><dt>Priority</dt><dd>${escapeHtml(wo.priority || 'Unset')}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(wo.status.replace('_', ' '))}</dd></div>
      ${timingRows}
    </dl>
    <div class="row" style="justify-content:flex-end; margin:18px 0 0;">
      <button class="ghost" onclick="window.viewCreatedWorkOrder()">View Work Order</button>
      <button class="primary" onclick="window.closeNewWoForm()">Done</button>
    </div>
  `;
  document.getElementById('wo-create-form-content').classList.add('hidden');
  successEl.classList.remove('hidden');
  lucide.createIcons({ root: successEl });
}

export function viewCreatedWorkOrder() {
  if (!createdWoConfirmation) return;
  const woId = createdWoConfirmation.id;
  closeNewWoForm();
  window.switchTab('wo');
  openWoDetailModal(woId);
}

export async function loadWorkOrders() {
  const list = document.getElementById('wo-list');
  list.innerHTML = getLoaderHtml('Fetching work orders...');
  
  const statuses = document.getElementById('wo-filter').value.split(',');
  const { data, error } = await sb.from('work_orders')
    .select('id, type, status, description, opened_at, closed_at, asset_id, schedule_id, priority, planned_date, assets(name)')
    .in('status', statuses).order('opened_at', { ascending: false }).limit(50);

  if (error) { list.innerHTML = `<div class="readout-empty">${error.message}</div>`; return; }
  state.activeWorkOrders = data || [];
  renderWorkOrders();
}

function renderWorkOrders() {
  const list = document.getElementById('wo-list');
  if (!state.activeWorkOrders.length) { list.innerHTML = '<div class="readout-empty"><i data-lucide="inbox" style="width:32px;height:32px;"></i> No work orders match.</div>'; lucide.createIcons(); return; }

  list.innerHTML = state.activeWorkOrders.map(wo => {
    const assetName = wo.asset_id == null ? 'No asset' : (wo.assets?.name || 'Unknown asset');
    return `
    <div class="panel wo-card" style="cursor:pointer;" data-search="${wo.id} ${wo.assets?.name || ''} ${wo.description || ''}".toLowerCase() onclick="window.openWoDetailModal(${wo.id})">
      <div class="row" style="margin-bottom:8px;justify-content:space-between">
        <div style="display:flex; gap:6px;">
          <span class="badge ${wo.type}">${wo.type === 'pm' ? '<i data-lucide="calendar-clock" style="width:12px;"></i>' : wo.type === 'other' ? '<i data-lucide="package" style="width:12px;"></i>' : '<i data-lucide="wrench" style="width:12px;"></i>'} ${wo.type}</span>
          <span class="badge ${wo.status}">${wo.status.replace('_',' ')}</span>
        </div>
        <span class="card-meta">#${wo.id}</span>
      </div>
      <div class="card-title">${escapeHtml(assetName)} <span class="badge ${priorityMeta(wo.priority).cls}" style="font-size:9px;">${priorityMeta(wo.priority).label}</span></div>
      <div style="margin:6px 0; font-size:13.5px; line-height:1.5; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${wo.description ? escapeHtml(wo.description) : 'No description provided'}</div>
      ${wo.planned_date ? `<div class="card-meta"><i data-lucide="calendar-clock" style="width:12px;display:inline-block;margin-right:2px;vertical-align:middle;"></i> Planned ${escapeHtml(wo.planned_date)}</div>` : ''}
      <div class="card-meta"><i data-lucide="clock" style="width:12px;display:inline-block;margin-right:2px;vertical-align:middle;"></i> Opened ${formatDate(wo.opened_at)}</div>
    </div>
  `;
  }).join('');
  
  lucide.createIcons();
}

export async function openWoDetailModal(id) {
  let wo = state.activeWorkOrders.find(w => w.id === id);
  if (!wo) {
    const { data } = await sb.from('work_orders').select('id, type, status, description, opened_at, closed_at, asset_id, schedule_id, priority, planned_date, assets(name)').eq('id', id).single();
    wo = data;
  }
  if (!wo) { toast('Work order not found', 'err'); return; }
  state.woDetailCurrent = wo;

  renderWoDetailHeader(wo, false);

  document.getElementById('wo-detail-update-btn').classList.toggle('hidden',
    !(wo.status !== 'closed' && (state.currentRole === 'admin' || state.currentRole === 'technician')));

  document.getElementById('modal-wo-detail').classList.remove('hidden');

  if (wo.type === 'pm' && wo.schedule_id) loadChecklistForWo(wo.id);
  else document.getElementById('wo-detail-checklist').classList.add('hidden');
  loadVisitsForWo(wo.id);

  lucide.createIcons({ root: document.getElementById('modal-wo-detail') });
}

function renderWoDetailHeader(wo, editing) {
  const canEdit = state.currentRole === 'admin' || state.currentRole === 'technician';
  const el = document.getElementById('wo-detail-header');
  const assetName = wo.asset_id == null ? 'No asset' : (wo.assets?.name || 'Unknown asset');

  if (editing) {
    el.innerHTML = `
      <div class="row" style="margin:8px 0;justify-content:space-between">
        <div style="display:flex; gap:6px;">
          <span class="badge ${wo.type}">${wo.type}</span>
          <span class="badge ${wo.status}">${wo.status.replace('_',' ')}</span>
        </div>
        <span class="card-meta">#${wo.id}</span>
      </div>
      <div class="card-title">${escapeHtml(assetName)}</div>
      <div class="field" style="margin-top:10px;">
        <label class="field-label">Priority</label>
        <select id="edit-wo-priority">
          <option value="" ${!wo.priority ? 'selected' : ''}>Unset</option>
          <option value="P1" ${wo.priority === 'P1' ? 'selected' : ''}>P1 &mdash; Critical</option>
          <option value="P2" ${wo.priority === 'P2' ? 'selected' : ''}>P2 &mdash; High</option>
          <option value="P3" ${wo.priority === 'P3' ? 'selected' : ''}>P3 &mdash; Normal</option>
          <option value="P4" ${wo.priority === 'P4' ? 'selected' : ''}>P4 &mdash; Low</option>
        </select>
      </div>
      <div class="field">
        <label class="field-label">Description</label>
        <textarea id="edit-wo-description">${escapeHtml(wo.description || '')}</textarea>
      </div>
      <div class="row" style="gap:8px; margin-bottom:0;">
        <button class="primary" style="padding:6px 12px; font-size:12px;" onclick="window.saveWoMetaEdit()">Save</button>
        <button class="ghost" style="padding:6px 12px; font-size:12px;" onclick="window.cancelWoMetaEdit()">Cancel</button>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="row" style="margin:8px 0;justify-content:space-between">
      <div style="display:flex; gap:6px;">
        <span class="badge ${wo.type}">${wo.type}</span>
        <span class="badge ${wo.status}">${wo.status.replace('_',' ')}</span>
        <span class="badge ${priorityMeta(wo.priority).cls}">${priorityMeta(wo.priority).label}</span>
      </div>
      <span class="card-meta">#${wo.id}</span>
    </div>
    ${wo.asset_id == null
      ? `<div class="card-title">No asset</div>`
      : `<div class="card-title" style="cursor:pointer; display:inline-flex; align-items:center; gap:6px;" onclick="window.closeWoDetailModal(); window.openAssetHistoryModal(${wo.asset_id}, '${escapeHtml(assetName).replace(/'/g, "\\'")}')">
          ${escapeHtml(assetName)} <i data-lucide="external-link" style="width:14px; color:var(--text-muted);"></i>
        </div>`}
    <div style="margin:8px 0; font-size:14px; line-height:1.5;">
      ${wo.description ? escapeHtml(wo.description) : '<span class="card-meta">No description provided</span>'}
      ${canEdit ? `<i data-lucide="pencil" style="width:12px; margin-left:6px; cursor:pointer; color:var(--text-muted); vertical-align:2px;" onclick="window.startEditWoMeta()"></i>` : ''}
    </div>
    <div class="card-meta">
      <i data-lucide="clock" style="width:12px;display:inline-block;margin-right:2px;vertical-align:middle;"></i> Opened ${formatDate(wo.opened_at)}
      ${wo.closed_at ? `<br><i data-lucide="check-circle-2" style="width:12px;display:inline-block;margin-right:2px;vertical-align:middle;margin-top:4px;"></i> Closed ${formatDate(wo.closed_at)}` : ''}
    </div>
  `;
  lucide.createIcons({ root: el });
}

export function startEditWoMeta() {
  renderWoDetailHeader(state.woDetailCurrent, true);
}

export function cancelWoMetaEdit() {
  renderWoDetailHeader(state.woDetailCurrent, false);
}

export async function saveWoMetaEdit() {
  const description = document.getElementById('edit-wo-description').value.trim();
  const priority = document.getElementById('edit-wo-priority').value || null;
  const before = state.woDetailCurrent;

  const { error } = await sb.from('work_orders').update({ description, priority }).eq('id', before.id);
  if (error) { toast(error.message, 'err'); return; }

  const changes = [];
  if (before.priority !== priority) changes.push(`Priority: ${before.priority || 'Unset'} \u2192 ${priority || 'Unset'}`);
  if ((before.description || '') !== description) changes.push('Description updated');
  if (changes.length) {
    const { error: visitErr } = await sb.from('wo_visits').insert({
      wo_id: before.id,
      visit_type: 'edited',
      action_taken: changes.join('; '),
      logged_by: state.currentUser.id,
    });
    if (visitErr) {
      const { error: rollbackErr } = await sb.from('work_orders').update({
        description: before.description,
        priority: before.priority,
      }).eq('id', before.id);
      toast(rollbackErr
        ? `Work order changed, but edit history failed: ${visitErr.message}`
        : `Work order edit rolled back: ${visitErr.message}`, 'err');
      return;
    }
  }

  state.woDetailCurrent.description = description;
  state.woDetailCurrent.priority = priority;
  renderWoDetailHeader(state.woDetailCurrent, false);
  loadVisitsForWo(before.id);
  toast('Work order updated');
  loadWorkOrders();
  loadOverview();
}

export function closeWoDetailModal() {
  document.getElementById('modal-wo-detail').classList.add('hidden');
  state.woDetailCurrent = null;
}

export function triggerUpdateFromDetail() {
  if (state.woDetailCurrent) triggerUpdateFlow(state.woDetailCurrent.id);
}

let currentVisits = [];

async function loadVisitsForWo(woId) {
  const box = document.getElementById('wo-detail-visits');
  box.innerHTML = getLoaderHtml('Loading activity...');
  const { data } = await sb.from('wo_visits')
    .select('id, visit_type, action_taken, parts_used, technician, visited_at')
    .eq('wo_id', woId)
    .order('visited_at', { ascending: false });
  currentVisits = data || [];
  renderVisitsList();
}

function renderVisitsList() {
  const box = document.getElementById('wo-detail-visits');
  const isPrivileged = state.currentRole === 'admin' || state.currentRole === 'technician';
  const EDIT_WINDOW_MS = 8 * 3600000;
  if (!currentVisits.length) { box.innerHTML = '<div class="card-meta">No updates logged yet.</div>'; return; }
  box.innerHTML = currentVisits.map(v => {
    if (v.editing) {
      return `
      <div class="activity-entry">
        <span class="activity-date">${formatDate(v.visited_at).split(',')[0]}</span>
        <div class="activity-body">
          <textarea id="edit-visit-notes-${v.id}" style="margin-bottom:6px;">${escapeHtml(v.action_taken || '')}</textarea>
          <div class="row" style="gap:8px; margin-bottom:6px;">
            <input id="edit-visit-parts-${v.id}" placeholder="Parts used" value="${escapeHtml(v.parts_used || '')}" style="flex:1;">
            <input id="edit-visit-tech-${v.id}" placeholder="Technician" value="${escapeHtml(v.technician || '')}" style="flex:1;">
          </div>
          <div class="row" style="gap:8px; margin-bottom:0;">
            <button class="primary" style="padding:5px 10px; font-size:11px;" onclick="window.saveVisitEdit(${v.id})">Save</button>
            <button class="ghost" style="padding:5px 10px; font-size:11px;" onclick="window.cancelEditVisit(${v.id})">Cancel</button>
          </div>
        </div>
      </div>`;
    }
    return `
    <div class="activity-entry">
      <span class="activity-date">${formatDate(v.visited_at).split(',')[0]}</span>
      <div class="activity-body">
        <p class="activity-title">${v.visit_type.replace('_',' ')}${v.technician ? ' \u00b7 ' + escapeHtml(v.technician) : ''}
          ${isPrivileged && (Date.now() - new Date(v.visited_at).getTime()) < EDIT_WINDOW_MS ? `<i data-lucide="pencil" style="width:11px; margin-left:6px; cursor:pointer; color:var(--text-muted);" onclick="window.startEditVisit(${v.id})"></i>` : ''}
        </p>
        ${v.action_taken ? `<p class="activity-meta">${escapeHtml(v.action_taken)}</p>` : ''}
        ${v.parts_used ? `<p class="activity-meta">Parts: ${escapeHtml(v.parts_used)}</p>` : ''}
      </div>
    </div>`;
  }).join('');
  lucide.createIcons({ root: box });
}

export function startEditVisit(id) {
  currentVisits = currentVisits.map(v => ({ ...v, editing: v.id === id }));
  renderVisitsList();
}

export function cancelEditVisit(id) {
  currentVisits = currentVisits.map(v => v.id === id ? { ...v, editing: false } : v);
  renderVisitsList();
}

export async function saveVisitEdit(id) {
  const action_taken = document.getElementById(`edit-visit-notes-${id}`).value.trim() || null;
  const parts_used = document.getElementById(`edit-visit-parts-${id}`).value.trim() || null;
  const technician = document.getElementById(`edit-visit-tech-${id}`).value.trim() || null;
  const { error } = await sb.from('wo_visits').update({ action_taken, parts_used, technician }).eq('id', id);
  if (error) { toast(error.message, 'err'); return; }
  currentVisits = currentVisits.map(v => v.id === id ? { ...v, action_taken, parts_used, technician, editing: false } : v);
  renderVisitsList();
  toast('Visit updated');
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
  const hasPlannedDate = !!state.woToUpdate.planned_date;
  document.getElementById('modal-wo-planned-date').value = state.woToUpdate.planned_date || '';
  document.getElementById('modal-planned-date-field').classList.toggle('hidden', !hasPlannedDate);
  document.getElementById('modal-planned-date-toggle').classList.toggle('hidden', hasPlannedDate);
  
  const updateAssetName = state.woToUpdate.asset_id == null ? 'No asset' : (state.woToUpdate.assets?.name || 'Unknown asset');
  document.getElementById('modal-wo-title').innerText = `WO #${state.woToUpdate.id} - ${updateAssetName}`;
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
  state.woToUpdate.pendingPlannedDate = document.getElementById('modal-wo-planned-date').value || null;
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

  const payload = { status: newStatus, planned_date: wo.pendingPlannedDate };
  if (newStatus === 'closed') payload.closed_at = new Date().toISOString();

  const { error } = await sb.from('work_orders').update(payload).eq('id', wo.id);
  if (error) { toast(error.message, 'err'); setButtonLoading('btn-confirm-save', false); return; }

  let completedAt = null;
  if (newStatus === 'closed' && wo.type === 'pm' && wo.schedule_id) {
    const { data: savedWo, error: closedAtErr } = await sb.from('work_orders')
      .select('closed_at')
      .eq('id', wo.id)
      .single();
    if (closedAtErr || !savedWo?.closed_at) {
      await sb.from('work_orders').update({
        status: wo.status,
        planned_date: wo.planned_date,
        closed_at: wo.closed_at,
      }).eq('id', wo.id);
      toast('PM close was not completed: could not verify closed_at', 'err');
      setButtonLoading('btn-confirm-save', false);
      return;
    }
    completedAt = savedWo.closed_at;
  }

  if (wo.pendingNote || wo.pendingParts || wo.pendingTechnician || newStatus !== wo.status) {
    const { error: visitErr } = await sb.from('wo_visits').insert({
      wo_id: wo.id,
      visit_type: wo.pendingVisitType,
      action_taken: wo.pendingNote || null,
      parts_used: wo.pendingParts || null,
      technician: wo.pendingTechnician || null,
      logged_by: state.currentUser.id,
    });
    if (visitErr) {
      const { error: rollbackErr } = await sb.from('work_orders').update({
        status: wo.status,
        planned_date: wo.planned_date,
        closed_at: wo.closed_at,
      }).eq('id', wo.id);
      toast(rollbackErr
        ? `Status changed, but visit record failed: ${visitErr.message}`
        : `Status update rolled back: ${visitErr.message}`, 'err');
      setButtonLoading('btn-confirm-save', false);
      return;
    }
  }

  if (newStatus === 'closed' && wo.type === 'pm' && wo.schedule_id) {
    const { error: scheduleErr } = await advanceScheduleForCompletedPm(wo.schedule_id, completedAt, wo.id);
    if (scheduleErr) {
      await sb.from('wo_visits').delete().eq('wo_id', wo.id).eq('visit_type', wo.pendingVisitType);
      await sb.from('work_orders').update({
        status: wo.status,
        planned_date: wo.planned_date,
        closed_at: wo.closed_at,
      }).eq('id', wo.id);
      toast('PM close was not completed: ' + scheduleErr.message, 'err');
      setButtonLoading('btn-confirm-save', false);
      return;
    }
    await loadSchedules();
  }

  toast('Work order updated successfully');
  closeUpdateModal();
  closeWoDetailModal();
  setButtonLoading('btn-confirm-save', false);
  loadWorkOrders();
  loadOverview();
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
