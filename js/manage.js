import { sb, state, toast, escapeHtml, getLoaderHtml } from './store.js';
import { getAssetSpecs, addAssetSpec, updateAssetSpec, deleteAssetSpec } from './assetSpecs.js';
import { ASSET_GLYPHS, renderAssetGlyph } from './assetGlyphs.js';

let currentManageAssetId = null;

export async function loadManageAssetList() {
  const list = document.getElementById('manage-asset-list');
  list.innerHTML = getLoaderHtml('Loading assets...');

  const { data, error } = await sb.from('assets').select('id, name, location, category').order('name');
  if (error) { list.innerHTML = `<div class="readout-empty">${error.message}</div>`; return; }
  if (!data || !data.length) { list.innerHTML = '<div class="readout-empty">No assets yet.</div>'; return; }

  list.innerHTML = data.map(a => `
    <div class="panel" style="cursor:pointer;" onclick="window.openManageAsset(${a.id}, '${escapeHtml(a.name).replace(/'/g, "\\'")}')">
      <div class="row" style="justify-content:space-between; margin-bottom:0;">
        <div class="card-title" style="margin:0;">${escapeHtml(a.name)}</div>
        <span class="card-meta">${a.category ? escapeHtml(a.category).replace('_',' ') : 'uncategorized'}</span>
      </div>
      <div class="card-meta">${a.location || 'No location set'}</div>
    </div>
  `).join('');
}

export async function openManageAsset(assetId, assetName) {
  currentManageAssetId = assetId;
  document.getElementById('manage-list-view').classList.add('hidden');
  document.getElementById('manage-detail-view').classList.remove('hidden');
  document.getElementById('manage-asset-title').textContent = assetName;

  const canWrite = state.currentRole === 'admin' || state.currentRole === 'technician';

  const catSelect = document.getElementById('manage-category-select');
  catSelect.innerHTML = ['', ...Object.keys(ASSET_GLYPHS).filter(k => k !== 'default')]
    .map(k => `<option value="${k}">${k ? k.replace('_',' ') : '— uncategorized —'}</option>`).join('');
  catSelect.disabled = !canWrite;

  const { data: asset } = await sb.from('assets').select('category').eq('id', assetId).single();
  catSelect.value = asset?.category || '';

  document.getElementById('manage-add-spec-row').classList.toggle('hidden', !canWrite);
  await refreshManageSpecs(canWrite);
}

export function backToManageList() {
  document.getElementById('manage-detail-view').classList.add('hidden');
  document.getElementById('manage-list-view').classList.remove('hidden');
  loadManageAssetList();
}

export async function saveManageCategory() {
  const category = document.getElementById('manage-category-select').value || null;
  const { error } = await sb.from('assets').update({ category }).eq('id', currentManageAssetId);
  if (error) { toast(error.message, 'err'); return; }
  toast('Category updated');
}

async function refreshManageSpecs(canWrite) {
  const box = document.getElementById('manage-specs-list');
  box.innerHTML = getLoaderHtml('Loading specs...');
  const specs = await getAssetSpecs(currentManageAssetId).catch(() => []);

  if (!specs.length) {
    box.innerHTML = '<div class="card-meta" style="padding:8px 0;">No specs added yet.</div>';
    return;
  }
  box.innerHTML = specs.map(s => `
    <div class="row" style="margin-bottom:8px; align-items:center;">
      <span style="flex:1; font-size:13px;">${escapeHtml(s.label)}</span>
      <input value="${escapeHtml(s.value ?? '')}" placeholder="value" style="width:90px;"
        ${canWrite ? '' : 'disabled'} onchange="window.saveManageSpecField(${s.id}, 'value', this.value)">
      <input value="${escapeHtml(s.unit ?? '')}" placeholder="unit" style="width:64px;"
        ${canWrite ? '' : 'disabled'} onchange="window.saveManageSpecField(${s.id}, 'unit', this.value)">
      ${canWrite ? `<button class="ghost" style="padding:4px 8px; border:1px solid var(--border);" onclick="window.deleteManageSpec(${s.id})"><i data-lucide="trash-2" style="width:13px; color:var(--red);"></i></button>` : ''}
    </div>
  `).join('');
  lucide.createIcons({ root: box });
}

export async function saveManageSpecField(specId, field, value) {
  const { error } = await updateAssetSpec(specId, { [field]: value || null }).catch(e => ({ error: e }));
  if (error) toast(error.message || 'Could not save', 'err');
}

export async function deleteManageSpec(specId) {
  await deleteAssetSpec(specId).catch(() => {});
  toast('Spec removed');
  refreshManageSpecs(true);
}

export async function addManageSpec() {
  const label = document.getElementById('manage-new-spec-label').value.trim();
  const value = document.getElementById('manage-new-spec-value').value.trim();
  const unit = document.getElementById('manage-new-spec-unit').value.trim();
  if (!label) { toast('Label required', 'err'); return; }
  await addAssetSpec(currentManageAssetId, { label, value: value || null, unit: unit || null }).catch(e => { toast(e.message, 'err'); throw e; });
  document.getElementById('manage-new-spec-label').value = '';
  document.getElementById('manage-new-spec-value').value = '';
  document.getElementById('manage-new-spec-unit').value = '';
  refreshManageSpecs(true);
}
