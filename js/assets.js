import { sb, state, toast, setButtonLoading, getLoaderHtml, escapeHtml, formatDate } from './store.js';
import { populateScheduleSelect } from './schedules.js';

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

export async function openAssetHistoryModal(assetId, assetName) {
  const modal = document.getElementById('modal-asset-history');
  const titleEl = document.getElementById('history-asset-title');
  const listContainer = document.getElementById('history-list-container');

  titleEl.textContent = assetName;
  listContainer.innerHTML = getLoaderHtml('Fetching history...');
  modal.classList.remove('hidden');

  const { data, error } = await sb.from('work_orders')
    .select('id, type, status, closed_at')
    .eq('asset_id', assetId)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(20);
  
  if (error) {
    listContainer.innerHTML = `<div class="card-meta" style="color:var(--red);">${error.message}</div>`;
    return;
  }
  
  if (!data || !data.length) {
    listContainer.innerHTML = '<div class="readout-empty"><i data-lucide="history" style="width:24px;height:24px;"></i> No completed work orders found.</div>';
    lucide.createIcons({ root: listContainer });
    return;
  }
  
  listContainer.innerHTML = data.map(wo => `
    <div style="font-size:13px; display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);">
      <span><span style="color:var(--text-muted)">#${wo.id}</span> &middot; ${wo.type}</span>
      <span style="color:var(--text-muted)">${formatDate(wo.closed_at)}</span>
    </div>
  `).join('');
}

export function closeAssetHistoryModal() {
  document.getElementById('modal-asset-history').classList.add('hidden');
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
