import { sb, state, toast, setButtonLoading, getLoaderHtml, escapeHtml, formatDate } from './store.js';
import { populateScheduleSelect, loadSchedules } from './schedules.js';
import { getAssetStatus, getAllWatchItemsForAsset } from './assetDetailHelpers.js';
import { getAssetSpecs } from './assetSpecs.js';
import { renderAssetGlyph } from './assetGlyphs.js';

export function openNewAssetForm() { document.getElementById('new-asset-form').classList.remove('hidden'); }
export function closeNewAssetForm() { document.getElementById('new-asset-form').classList.add('hidden'); }

export async function createAsset() {
  const name = document.getElementById('asset-name').value.trim();
  const location = document.getElementById('asset-location').value.trim();
  const criticality = document.getElementById('asset-criticality').value || null;
  if (!name) { toast('Name required', 'err'); return; }
  
  setButtonLoading('btn-create-asset', true);
  const { error } = await sb.from('assets').insert({ name, location, criticality });
  if (error) { toast(error.message, 'err'); setButtonLoading('btn-create-asset', false); return; }
  
  toast('Asset created');
  closeNewAssetForm();
  document.getElementById('asset-name').value = '';
  document.getElementById('asset-location').value = '';
  setButtonLoading('btn-create-asset', false);
  await loadAssets(true);
}

export async function loadAssets(render) {
  const list = document.getElementById('asset-list');
  if (render) list.innerHTML = getLoaderHtml('Loading assets...');
  
  const { data, error } = await sb.from('assets').select('*').order('name');
  if (!error) state.assetsCache = data || [];
  
  if (render) {
    if (error) { list.innerHTML = `<div class="readout-empty">${error.message}</div>`; return; }
    if (!state.assetsCache.length) { list.innerHTML = '<div class="readout-empty"><i data-lucide="server" style="width:32px;height:32px;"></i> No assets provisioned.</div>'; lucide.createIcons(); return; }
    
    list.innerHTML = state.assetsCache.map(a => `
      <div class="panel">
        <div class="row" style="justify-content:space-between; margin-bottom:4px;">
          <div class="card-title" style="margin:0; cursor:pointer; transition: opacity 0.2s;" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1" onclick="window.openAssetHistoryModal(${a.id}, '${escapeHtml(a.name).replace(/'/g, "\\'")}')">
            ${escapeHtml(a.name)} <i data-lucide="external-link" style="width:14px; margin-left:4px; color:var(--text-muted);"></i>
          </div>
          ${a.criticality ? `<span class="badge open"><i data-lucide="alert-triangle" style="width:10px;"></i> ${a.criticality}</span>` : ''}
        </div>
        <div class="card-meta"><i data-lucide="map-pin" style="width:12px; display:inline-block; vertical-align:-2px;"></i> ${a.location || 'No location set'}</div>
      </div>
    `).join('');
    lucide.createIcons();
  }
}

export function switchAssetModalTab(tab) {
  document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.modalTab === tab));
  document.querySelectorAll('[data-modal-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.modalPanel !== tab));
}

export async function openAssetHistoryModal(assetId, assetName) {
  document.getElementById('asset-page').classList.remove('hidden');
  window.scrollTo(0, 0);

  const titleEl = document.getElementById('history-asset-title');
  const glyphEl = document.getElementById('asset-page-glyph');
  const statusEl = document.getElementById('asset-page-status');
  const specsEl = document.getElementById('asset-page-specs');
  const watchEl = document.getElementById('asset-page-watch');
  const openContainer = document.getElementById('history-open-container');
  const schedContainer = document.getElementById('history-schedules-container');
  const historyContainer = document.getElementById('history-list-container');

  titleEl.textContent = assetName;
  glyphEl.innerHTML = '';
  statusEl.innerHTML = getLoaderHtml('Loading...');
  specsEl.innerHTML = '';
  watchEl.innerHTML = '';
  openContainer.innerHTML = getLoaderHtml('Loading...');
  schedContainer.innerHTML = getLoaderHtml('Loading...');
  historyContainer.innerHTML = getLoaderHtml('Loading...');
  switchAssetModalTab('open');

  const [woRes, schedRes] = await Promise.all([
    sb.from('work_orders')
      .select('id, type, status, opened_at, closed_at, schedule_id')
      .eq('asset_id', assetId)
      .order('opened_at', { ascending: false })
      .limit(50),
    sb.from('recurring_schedules')
      .select('id, title, interval_days, next_due_at, active')
      .eq('asset_id', assetId)
      .eq('active', true)
      .order('next_due_at'),
  ]);

  let lastPmBySchedule = {};

  if (woRes.error) {
    openContainer.innerHTML = `<div class="card-meta" style="color:var(--red);">${woRes.error.message}</div>`;
    historyContainer.innerHTML = '';
  } else {
    const all = woRes.data || [];
    const open = all.filter(wo => wo.status !== 'closed');
    const closed = all.filter(wo => wo.status === 'closed').slice(0, 20);

    all.filter(wo => wo.type === 'pm' && wo.status === 'closed' && wo.schedule_id).forEach(wo => {
      const cur = lastPmBySchedule[wo.schedule_id];
      if (!cur || new Date(wo.closed_at) > new Date(cur.closed_at)) lastPmBySchedule[wo.schedule_id] = wo;
    });

    openContainer.innerHTML = open.length ? open.map(wo => `
      <div class="activity-entry">
        <span class="activity-date">${formatDate(wo.opened_at).split(',')[0]}</span>
        <div class="activity-body">
          <p class="activity-title">#${wo.id} &middot; ${wo.type} <span class="badge ${wo.status}" style="font-size:9px;">${wo.status.replace('_',' ')}</span></p>
        </div>
      </div>
    `).join('') : '<div class="card-meta">No open work orders.</div>';

    historyContainer.innerHTML = closed.length ? closed.map(wo => `
      <div class="activity-entry">
        <span class="activity-date">${formatDate(wo.closed_at).split(',')[0]}</span>
        <div class="activity-body">
          <p class="activity-title">#${wo.id} &middot; ${wo.type}</p>
        </div>
      </div>
    `).join('') : '<div class="card-meta">No closed work orders yet.</div>';
  }

  // Rail: glyph, derived status, specs, watch items — read-only; editing lives only in the Manage tab.
  (async () => {
    const cached = state.assetsCache?.find(a => a.id === assetId);
    const category = cached?.category || null;
    glyphEl.innerHTML = renderAssetGlyph(category);

    const [statusRes, specs] = await Promise.all([
      getAssetStatus(assetId).catch(() => ({ label: 'Unknown', tone: 'amber' })),
      getAssetSpecs(assetId).catch(() => []),
    ]);
    statusEl.innerHTML = `<div class="status-pill ${statusRes.tone}">${statusRes.label}</div>`;

    specsEl.innerHTML = specs.length ? specs.map(s => `
      <div class="row" style="justify-content:space-between; margin-bottom:6px;">
        <span class="card-meta">${escapeHtml(s.label)}</span>
        <span style="font-size:13px;">${escapeHtml(s.value ?? '\u2014')}${s.unit ? ' ' + escapeHtml(s.unit) : ''}</span>
      </div>
    `).join('') : '<div class="card-meta">No specs added yet. Add them in the Manage tab.</div>';

    const scheduleIds = (schedRes.data || []).map(s => s.id);
    const watchItems = scheduleIds.length ? await getAllWatchItemsForAsset(assetId, scheduleIds).catch(() => []) : [];
    watchEl.innerHTML = watchItems.length ? `
      <div class="watch-banner">
        <b>Watch items from last inspection</b>
        ${watchItems.map(w => `${escapeHtml(w.description)}: ${escapeHtml(w.note)} <span class="card-meta">(${w.date})</span>`).join('<br>')}
      </div>` : '';
  })();

  if (schedRes.error) {
    schedContainer.innerHTML = `<div class="card-meta" style="color:var(--red);">${schedRes.error.message}</div>`;
  } else if (!schedRes.data || !schedRes.data.length) {
    schedContainer.innerHTML = '<div class="card-meta">No PM schedules for this asset.</div>';
  } else {
    const scheduleIds = schedRes.data.map(s => s.id);
    const { data: items } = await sb.from('checklist_items')
      .select('id, schedule_id, description, item_type, unit')
      .in('schedule_id', scheduleIds)
      .eq('active', true)
      .order('added_at');
    const itemsBySchedule = {};
    (items || []).forEach(i => {
      (itemsBySchedule[i.schedule_id] = itemsBySchedule[i.schedule_id] || []).push(i);
    });

    schedContainer.innerHTML = schedRes.data.map(s => {
      const its = itemsBySchedule[s.id] || [];
      const lastPm = lastPmBySchedule[s.id];
      const itemsHtml = its.length ? its.map(i => `
        <div class="checklist-item" style="padding:6px 0;">
          <i data-lucide="${i.item_type === 'reading' ? 'gauge' : 'minus'}" style="width:12px; color:var(--text-muted); margin-top:2px;"></i>
          <span>${escapeHtml(i.description)}${i.item_type === 'reading' ? ` <span class="card-meta">(${escapeHtml(i.unit)})</span>` : ''}</span>
        </div>
      `).join('') : '<div class="card-meta" style="padding:6px 0;">No checklist items yet.</div>';

      return `
      <div style="padding:10px 0; border-bottom:1px solid var(--border);">
        <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="window.toggleScheduleItems(${s.id})">
          <span style="font-size:13px;">${escapeHtml(s.title)} <span class="card-meta">&middot; every ${s.interval_days}d &middot; due ${s.next_due_at}${lastPm ? ` &middot; last PM ${formatDate(lastPm.closed_at).split(',')[0]}` : ''}</span></span>
          <div style="display:flex; align-items:center; gap:6px;">
            <i data-lucide="chevron-down" id="sched-chevron-${s.id}" style="width:14px; color:var(--text-muted); transition:transform 0.2s;"></i>
            <button class="ghost" style="padding:4px 8px; font-size:11px; border:1px solid var(--border);" onclick="event.stopPropagation(); window.goToSchedule(${s.id})">Edit &rarr;</button>
          </div>
        </div>
        <div id="sched-items-${s.id}" class="hidden" style="margin-top:8px; padding-left:4px;">${itemsHtml}</div>
      </div>`;
    }).join('');
  }
  lucide.createIcons({ root: document.getElementById('asset-page') });
}

export function closeAssetHistoryModal() {
  document.getElementById('asset-page').classList.add('hidden');
}

export function toggleScheduleItems(scheduleId) {
  const box = document.getElementById('sched-items-' + scheduleId);
  const chevron = document.getElementById('sched-chevron-' + scheduleId);
  if (!box) return;
  const isHidden = box.classList.contains('hidden');
  box.classList.toggle('hidden');
  if (chevron) chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

export async function goToSchedule(scheduleId) {
  closeAssetHistoryModal();
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'schedules'));
  ['wo','assets','schedules'].forEach(t => document.getElementById('tab-' + t).classList.toggle('hidden', t !== 'schedules'));
  await loadSchedules();
  const el = document.getElementById('schedule-card-' + scheduleId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash-highlight');
    setTimeout(() => el.classList.remove('flash-highlight'), 1500);
  }
}

// Custom Searchable Dropdown Logic
export function renderAssetDropdown(filter = '') {
  const dropdownList = document.getElementById('wo-asset-dropdown');
  const term = filter.toLowerCase();
  const filtered = state.assetsCache.filter(a => a.name.toLowerCase().includes(term));
  
  if (!filtered.length) {
    dropdownList.innerHTML = '<div style="padding:10px 12px; font-size:13px; color:var(--text-muted);">No assets found.</div>';
    return;
  }
  
  dropdownList.innerHTML = filtered.map(a => 
    `<div class="custom-select-item" onclick="window.selectAsset(${a.id}, '${escapeHtml(a.name).replace(/'/g, "\\'")}')">
      ${escapeHtml(a.name)}
      ${a.location ? `<span style="color:var(--text-muted); font-size:12px; display:block; margin-top:2px;">${escapeHtml(a.location)}</span>` : ''}
    </div>`
  ).join('');
}

export function selectAsset(id, name) {
  document.getElementById('wo-asset-value').value = id;
  document.getElementById('wo-asset-search').value = name;
  document.getElementById('wo-asset-dropdown').classList.add('hidden');
  if (document.getElementById('wo-type').value === 'pm') populateScheduleSelect('wo-schedule');
}
