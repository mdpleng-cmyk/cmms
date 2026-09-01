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
          <div class="card-title" style="margin:0;">${escapeHtml(a.name)}</div>
          ${a.criticality ? `<span class="badge open"><i data-lucide="alert-triangle" style="width:10px;"></i> ${a.criticality}</span>` : ''}
        </div>
        <div class="card-meta"><i data-lucide="map-pin" style="width:12px; display:inline-block; vertical-align:-2px;"></i> ${a.location || 'No location set'}</div>
        <button class="ghost" style="padding:6px 0; margin-top:8px; font-size:12px; color:var(--text-muted);" onclick="window.toggleAssetHistory(${a.id}, this)">
          <i data-lucide="history" style="width:14px;"></i> View Maintenance History
        </button>
        <div id="asset-hist-${a.id}" class="hidden" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);"></div>
      </div>
    `).join('');
    lucide.createIcons();
  }
}

export async function toggleAssetHistory(assetId, btnEl) {
  const histDiv = document.getElementById(`asset-hist-${assetId}`);
  if (!histDiv.classList.contains('hidden')) {
    histDiv.classList.add('hidden');
    btnEl.innerHTML = `<i data-lucide="history" style="width:14px;"></i> View Maintenance History`;
    lucide.createIcons({ root: btnEl });
    return;
  }
  histDiv.classList.remove('hidden');
  btnEl.innerHTML = `<i data-lucide="chevron-up" style="width:14px;"></i> Hide History`;
  lucide.createIcons({ root: btnEl });
  histDiv.innerHTML = getLoaderHtml('Fetching history...');
  
  const { data } = await sb.from('work_orders').select('id, type, status, closed_at').eq('asset_id', assetId).eq('status', 'closed').order('closed_at', { ascending: false }).limit(5);
  
  if (!data || !data.length) {
    histDiv.innerHTML = '<div class="card-meta">No completed work orders found.</div>';
    return;
  }
  histDiv.innerHTML = data.map(wo => `
    <div style="font-size:12px; display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
      <span><span style="color:var(--text-muted)">#${wo.id}</span> &middot; ${wo.type}</span>
      <span style="color:var(--text-muted)">${formatDate(wo.closed_at)}</span>
    </div>
  `).join('');
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
