import { sb, state, toast, setButtonLoading, getLoaderHtml, escapeHtml, formatDate, formatDateOnly, formatTime12, getAssetDisplayName } from './store.js';
import { loadSchedules } from './schedules.js';
import { getAssetStatus, getAllWatchItemsForAsset } from './assetDetailHelpers.js';
import { getAssetSpecs } from './assetSpecs.js';
import { renderAssetGlyph } from './assetGlyphs.js';

export async function openNewAssetForm() {
  document.getElementById('new-asset-form').classList.remove('hidden');
  document.getElementById('asset-is-multiple').checked = false;
  document.getElementById('asset-class-fields').classList.add('hidden');
  document.getElementById('asset-new-type-field').classList.add('hidden');
  document.getElementById('asset-new-type-name').value = '';
  await refreshEquipmentTypeSelect();
}

async function refreshEquipmentTypeSelect() {
  const sel = document.getElementById('asset-equipment-type');
  const { data } = await sb.from('equipment_types').select('id, name').order('name');
  sel.innerHTML =
    '<option value="">\u2014 select \u2014</option>' +
    (data || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('') +
    '<option value="__new__">+ Create new class...</option>';
}

export function toggleAssetClassFields(checked) {
  document.getElementById('asset-class-fields').classList.toggle('hidden', !checked);
  if (!checked) {
    document.getElementById('asset-equipment-type').value = '';
    document.getElementById('asset-new-type-field').classList.add('hidden');
  }
}

export async function onEquipmentTypeChange() {
  const sel = document.getElementById('asset-equipment-type');
  const isNew = sel.value === '__new__';
  document.getElementById('asset-new-type-field').classList.toggle('hidden', !isNew);
  if (isNew || !sel.value) return;

  // Suggest "<Class> <N+1>" as the name, only if the user hasn't typed one yet.
  const nameEl = document.getElementById('asset-name');
  if (nameEl.value.trim()) return;
  const className = sel.options[sel.selectedIndex].textContent;
  const { count } = await sb.from('assets').select('id', { count: 'exact', head: true }).eq('equipment_type_id', sel.value);
  nameEl.value = `${className} ${(count || 0) + 1}`;
}

export function closeNewAssetForm() { document.getElementById('new-asset-form').classList.add('hidden'); }

export async function createAsset() {
  const name = document.getElementById('asset-name').value.trim();
  const location = document.getElementById('asset-location').value.trim();
  const department = document.getElementById('asset-department').value || null;
  const criticality = document.getElementById('asset-criticality').value || null;
  const isMultiple = document.getElementById('asset-is-multiple').checked;
  if (!name) { toast('Name required', 'err'); return; }

  let equipment_type_id = null;
  if (isMultiple) {
    const sel = document.getElementById('asset-equipment-type').value;
    if (sel === '__new__') {
      const newName = document.getElementById('asset-new-type-name').value.trim();
      if (!newName) { toast('Enter a name for the new asset class', 'err'); return; }
      const { data: newType, error: typeErr } = await sb.from('equipment_types').insert({ name: newName }).select().single();
      if (typeErr) { toast(typeErr.message, 'err'); return; }
      equipment_type_id = newType.id;
    } else if (sel) {
      equipment_type_id = sel;
    } else {
      toast('Select or create an asset class', 'err'); return;
    }
  }

  setButtonLoading('btn-create-asset', true);
  const { error } = await sb.from('assets').insert({ name, location, department, criticality, equipment_type_id });
  if (error) { toast(error.message, 'err'); setButtonLoading('btn-create-asset', false); return; }
  
  toast('Asset created');
  closeNewAssetForm();
  document.getElementById('asset-name').value = '';
  document.getElementById('asset-location').value = '';
  setButtonLoading('btn-create-asset', false);
  await loadAssets(true);
}

let assetTabFilter = 'all';

export function setAssetTabFilter(filter) {
  assetTabFilter = filter;
  document.querySelectorAll('[data-asset-filter]').forEach(b => {
    b.classList.toggle('active', b.dataset.assetFilter === filter);
  });
  renderAssetsTable();
}

export function filterAssetsTab() {
  renderAssetsTable();
}

export function renderAssetsTable() {
  const container = document.getElementById('asset-list');
  const countEl = document.getElementById('asset-tab-count');
  if (!container) return;

  const search = (document.getElementById('asset-search')?.value || '').trim().toLowerCase();

  let list = state.assetsCache || [];
  if (assetTabFilter === 'p1-p2') {
    list = list.filter(a => a.criticality === 'P1' || a.criticality === 'P2');
  } else if (assetTabFilter === 'down') {
    list = list.filter(a => a.status === 'down');
  }

  if (search) {
    list = list.filter(a =>
      ((a.displayName || a.name) && (a.displayName || a.name).toLowerCase().includes(search)) ||
      (a.category && a.category.toLowerCase().includes(search)) ||
      (a.location && a.location.toLowerCase().includes(search)) ||
      (a.department && a.department.toLowerCase().includes(search)) ||
      (a.criticality && a.criticality.toLowerCase().includes(search))
    );
  }

  if (countEl) {
    countEl.textContent = `${list.length} ${list.length === 1 ? 'asset' : 'assets'}`;
  }

  if (!list.length) {
    container.innerHTML = `
      <div class="manage-table-panel">
        <div class="empty-note" style="padding:40px; text-align:center; color:var(--ov-text-muted); font-size:12.5px;">No assets match your search or filter.</div>
      </div>`;
    return;
  }

  const rows = list.map(a => {
    const displayName = a.displayName || (a.equipment_types?.name ? `${a.equipment_types.name} - ${a.name}` : a.name);
    const dotCls = a.status === 'down' ? 'down' : a.status === 'maintenance' ? 'maintenance' : '';
    const dotTitle = a.status === 'down' ? 'Down (Open breakdown)' : a.status === 'maintenance' ? 'Under maintenance (Open PM)' : 'Running';
    const critCls = a.criticality ? `crit-${a.criticality.toLowerCase()}` : '';
    const catFormatted = a.category ? escapeHtml(a.category.replace('_', ' ')) : '—';
    const locFormatted = a.location ? escapeHtml(a.location) : '—';
    const deptFormatted = a.department ? escapeHtml(a.department) : '—';
    const catTag = a.category ? `<span class="asset-class">${escapeHtml(a.category.toUpperCase().replace(/_/g, ''))}</span>` : '';

    return `
      <tr onclick="window.openAssetHistoryModal(${a.id}, '${escapeHtml(displayName).replace(/'/g, "\\'")}')">
        <td>
          <div class="asset-cell">
            <span class="status-dot ${dotCls}" title="${dotTitle}"></span>
            <span class="asset-name">${escapeHtml(displayName)}</span>
            ${catTag}
          </div>
        </td>
        <td class="muted-cell">${catFormatted}</td>
        <td class="muted-cell">${locFormatted}</td>
        <td class="muted-cell">${deptFormatted}</td>
        <td>${a.criticality ? `<span class="crit ${critCls}">${escapeHtml(a.criticality)}</span>` : '<span class="card-meta">—</span>'}</td>
        <td class="row-actions" title="View details">&#8942;</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="manage-table-panel">
      <div class="manage-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Category</th>
              <th>Location</th>
              <th>Department</th>
              <th>Criticality</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;
}

export async function loadAssets(render) {
  const list = document.getElementById('asset-list');
  if (render && list) list.innerHTML = getLoaderHtml('Loading assets...');
  
  const [assetsRes, breakdownRes, pmRes] = await Promise.all([
    sb.from('assets').select('*, equipment_types(id, name)').order('name'),
    sb.from('work_orders').select('asset_id').eq('type', 'breakdown').in('status', ['open', 'in_progress']),
    sb.from('work_orders').select('asset_id').eq('type', 'pm').in('status', ['open', 'in_progress']),
  ]);
  
  if (assetsRes.error) {
    if (render && list) list.innerHTML = `<div class="readout-empty">${assetsRes.error.message}</div>`;
    return;
  }
  
  const downSet = new Set((breakdownRes.data || []).map(w => w.asset_id));
  const pmSet = new Set((pmRes.data || []).map(w => w.asset_id));
  
  state.assetsCache = (assetsRes.data || []).map(a => ({
    ...a,
    displayName: a.equipment_types?.name ? `${a.equipment_types.name} - ${a.name}` : a.name,
    status: downSet.has(a.id) ? 'down' : pmSet.has(a.id) ? 'maintenance' : 'running'
  }));
  
  if (render) {
    if (!state.assetsCache.length) {
      if (list) list.innerHTML = '<div class="readout-empty"><i data-lucide="server" style="width:32px;height:32px;"></i> No assets provisioned.</div>';
      lucide.createIcons();
      return;
    }
    renderAssetsTable();
  }
}

export function switchAssetModalTab(tab) {
  document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.modalTab === tab));
  document.querySelectorAll('[data-modal-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.modalPanel !== tab));
}

export async function openAssetHistoryModal(assetId, assetName, initialTab = 'open') {
  document.getElementById('asset-page').classList.remove('hidden');

  const titleEl = document.getElementById('history-asset-title');
  const glyphEl = document.getElementById('asset-page-glyph');
  const statusEl = document.getElementById('asset-page-status');
  const specsEl = document.getElementById('asset-page-specs');
  const watchEl = document.getElementById('asset-page-watch');
  const openContainer = document.getElementById('history-open-container');
  const schedContainer = document.getElementById('history-schedules-container');
  const historyContainer = document.getElementById('history-list-container');

  state.assetPageCurrent = { id: assetId, name: assetName };
  titleEl.textContent = assetName;
  glyphEl.innerHTML = '';
  statusEl.innerHTML = getLoaderHtml('Loading...');
  specsEl.innerHTML = '';
  watchEl.innerHTML = '';
  openContainer.innerHTML = getLoaderHtml('Loading...');
  schedContainer.innerHTML = getLoaderHtml('Loading...');
  historyContainer.innerHTML = getLoaderHtml('Loading...');
  switchAssetModalTab(initialTab);

  const [woRes, schedRes] = await Promise.all([
    sb.from('work_orders')
      .select('id, type, status, description, opened_at, closed_at, schedule_id')
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
      <div class="activity-entry" style="cursor:pointer;" onclick="window.closeAssetHistoryModal(); window.openWoDetailModal(${wo.id})">
        <div class="activity-date">
          <div class="activity-date-day">${formatDateOnly(wo.opened_at)}</div>
          <div class="activity-date-time">${formatTime12(wo.opened_at)}</div>
        </div>
        <div class="activity-body">
          <p class="activity-title">#${wo.id} &middot; <span class="badge ${wo.type}" style="font-size:9px;">${wo.type}</span> <span class="badge ${wo.status}" style="font-size:9px;">${wo.status.replace('_',' ')}</span></p>
          <p class="activity-meta" style="overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${wo.description ? escapeHtml(wo.description) : 'No description provided'}</p>
        </div>
      </div>
    `).join('') : '<div class="card-meta">No open work orders.</div>';

    historyContainer.innerHTML = closed.length ? closed.map(wo => `
      <div class="activity-entry" style="cursor:pointer;" onclick="window.closeAssetHistoryModal(); window.openWoDetailModal(${wo.id})">
        <div class="activity-date">
          <div class="activity-date-day">${formatDateOnly(wo.closed_at)}</div>
          <div class="activity-date-time">${formatTime12(wo.closed_at)}</div>
        </div>
        <div class="activity-body">
          <p class="activity-title">#${wo.id} &middot; <span class="badge ${wo.type}" style="font-size:9px;">${wo.type}</span></p>
          <p class="activity-meta" style="overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${wo.description ? escapeHtml(wo.description) : 'No description provided'}</p>
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
    schedContainer.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div class="card-meta">No PM schedules for this asset.</div>
        <button class="primary" style="padding:4px 10px; font-size:11px; display:inline-flex; align-items:center; gap:4px;" onclick="window.openNewScheduleForCurrentAsset()">
          <i data-lucide="calendar-plus" style="width:12px;"></i> Create PM Schedule
        </button>
      </div>`;
  } else {
    const scheduleIds = schedRes.data.map(s => s.id);
    const { data: items } = await sb.from('checklist_items')
      .select('id, schedule_id, description, item_type, unit, section, tool, sort_order')
      .in('schedule_id', scheduleIds)
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });
    const itemsBySchedule = {};
    (items || []).forEach(i => {
      (itemsBySchedule[i.schedule_id] = itemsBySchedule[i.schedule_id] || []).push(i);
    });

    const headerHtml = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border);">
        <span class="card-meta" style="font-weight:600;">${schedRes.data.length} PM Routine${schedRes.data.length !== 1 ? 's' : ''} Configured</span>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="ghost" style="padding:4px 8px; font-size:11px; border:1px solid var(--border); display:inline-flex; align-items:center; gap:4px;" onclick="window.openNewScheduleForCurrentAsset()">
            <i data-lucide="calendar-plus" style="width:12px; color:var(--green);"></i> + Add Routine
          </button>
          <button class="ghost" style="padding:4px 8px; font-size:11px; border:1px solid var(--border); display:inline-flex; align-items:center; gap:4px;" onclick="window.manageAssetPmRoutines(${assetId}, '${escapeHtml(assetName).replace(/'/g, "\\'")}')">
            <i data-lucide="settings" style="width:12px;"></i> Manage &rarr;
          </button>
        </div>
      </div>
    `;

    schedContainer.innerHTML = headerHtml + schedRes.data.map(s => {
      const its = itemsBySchedule[s.id] || [];
      const lastPm = lastPmBySchedule[s.id];
      const itemsHtml = its.length ? its.map(i => `
        <div class="checklist-item" style="padding:6px 0; display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <i data-lucide="${i.item_type === 'reading' ? 'gauge' : 'minus'}" style="width:12px; color:var(--text-muted); margin-top:2px;"></i>
            <span>${escapeHtml(i.description)}${i.item_type === 'reading' ? ` <span class="card-meta">(${escapeHtml(i.unit || '')})</span>` : ''}</span>
          </div>
          ${i.tool ? `<span class="pm-tool-chip" style="font-size:10.5px; padding:1px 6px;">🔧 ${escapeHtml(i.tool)}</span>` : ''}
        </div>
      `).join('') : '<div class="card-meta" style="padding:6px 0;">No checklist items yet.</div>';

      return `
      <div style="padding:10px 0; border-bottom:1px solid var(--border);">
        <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="window.toggleScheduleItems(${s.id})">
          <span style="font-size:13px;">${escapeHtml(s.title)} <span class="card-meta">&middot; every ${s.interval_days}d &middot; due ${s.next_due_at}${lastPm ? ` &middot; last PM ${formatDate(lastPm.closed_at).split(',')[0]}` : ''}</span></span>
          <div style="display:flex; align-items:center; gap:6px;">
            <i data-lucide="chevron-down" id="sched-chevron-${s.id}" style="width:14px; color:var(--text-muted); transition:transform 0.2s;"></i>
            <button class="ghost" style="padding:4px 8px; font-size:11px; border:1px solid var(--border);" onclick="event.stopPropagation(); window.goToSchedule(${s.id})">PM Board &rarr;</button>
          </div>
        </div>
        <div id="sched-items-${s.id}" class="hidden" style="margin-top:8px; padding-left:4px;">${itemsHtml}</div>
      </div>`;
    }).join('');
  }
  lucide.createIcons({ root: document.getElementById('asset-page') });
}

export function openNewScheduleForCurrentAsset() {
  const current = state.assetPageCurrent;
  if (!current || !current.id) return;
  window.openNewScheduleForm(current.id, current.name);
}

export function manageAssetPmRoutines(assetId, assetName) {
  closeAssetHistoryModal();
  window.switchTab('manage');
  window.switchManageMode('assets');
  window.openManageAsset(assetId, assetName);
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
  ['wo','assets','schedules','telemetry'].forEach(t => document.getElementById('tab-' + t).classList.toggle('hidden', t !== 'schedules'));
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
  const filtered = state.assetsCache.filter(a => (a.displayName || a.name).toLowerCase().includes(term));
  
  if (!filtered.length) {
    dropdownList.innerHTML = term
      ? `<div style="padding:10px 12px; font-size:13px; color:var(--text-muted);">No matching asset found</div>
         <button type="button" class="custom-select-item" style="width:100%; text-align:left; color:var(--amber);" onclick="window.logWithoutAsset()">+ Log without an asset</button>`
      : '';
    return;
  }
  
  dropdownList.innerHTML = filtered.map(a => {
    const displayName = a.displayName || (a.equipment_types?.name ? `${a.equipment_types.name} - ${a.name}` : a.name);
    const down = state.assetStatusCache[a.id]?.hasBreakdown;
    const dot = down
      ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--red);margin-right:6px;" title="Has an open breakdown"></span>'
      : '';
    return `<div class="custom-select-item" onclick="window.selectAsset(${a.id}, '${escapeHtml(displayName).replace(/'/g, "\\'")}')">
      ${dot}${escapeHtml(displayName)}
      ${a.location ? `<span style="color:var(--text-muted); font-size:12px; display:block; margin-top:2px;">${escapeHtml(a.location)}</span>` : ''}
    </div>`;
  }).join('');
}

export function selectAsset(id, name) {
  document.getElementById('wo-asset-value').value = id;
  document.getElementById('wo-asset-search').value = name;
  document.getElementById('wo-asset-dropdown').classList.add('hidden');

  const prioritySel = document.getElementById('wo-priority');
  const asset = state.assetsCache.find(a => a.id === id);
  if (prioritySel && asset?.criticality) prioritySel.value = asset.criticality;
}

window.setAssetTabFilter = setAssetTabFilter;
window.filterAssetsTab = filterAssetsTab;
