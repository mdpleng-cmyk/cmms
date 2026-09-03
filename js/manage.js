import { sb, state, toast, escapeHtml, getLoaderHtml } from './store.js';
import { getAssetSpecs, addAssetSpec, updateAssetSpec, deleteAssetSpec } from './assetSpecs.js';
import { ASSET_GLYPHS, renderAssetGlyph } from './assetGlyphs.js';

let currentTypeId = null;

export function switchManageMode(mode) {
  document.querySelectorAll('[data-manage-mode]').forEach(b => b.classList.toggle('active', b.dataset.manageMode === mode));
  document.getElementById('manage-assets-mode').classList.toggle('hidden', mode !== 'assets');
  document.getElementById('manage-types-mode').classList.toggle('hidden', mode !== 'types');
  if (mode === 'types') {
    document.getElementById('manage-types-detail-view').classList.add('hidden');
    document.getElementById('manage-types-list-view').classList.remove('hidden');
    loadEquipmentTypesList();
  }
}

export async function loadEquipmentTypesList() {
  const list = document.getElementById('manage-types-list');
  list.innerHTML = getLoaderHtml('Loading...');
  const { data, error } = await sb.from('equipment_types').select('id, name').order('name');
  if (error) { list.innerHTML = `<div class="readout-empty">${error.message}</div>`; return; }
  if (!data || !data.length) { list.innerHTML = '<div class="readout-empty">No equipment types yet.</div>'; return; }
  list.innerHTML = data.map(t => `
    <div class="panel" style="cursor:pointer;" onclick="window.openManageType(${t.id}, '${escapeHtml(t.name).replace(/'/g, "\\'")}')">
      <div class="card-title" style="margin:0;">${escapeHtml(t.name)}</div>
    </div>
  `).join('');
}

export async function createEquipmentType() {
  const name = document.getElementById('new-type-name').value.trim();
  if (!name) { toast('Name required', 'err'); return; }
  const { error } = await sb.from('equipment_types').insert({ name });
  if (error) { toast(error.message, 'err'); return; }
  document.getElementById('new-type-name').value = '';
  toast('Equipment type created');
  loadEquipmentTypesList();
}

export async function openManageType(typeId, name) {
  currentTypeId = typeId;
  document.getElementById('manage-types-list-view').classList.add('hidden');
  document.getElementById('manage-types-detail-view').classList.remove('hidden');
  document.getElementById('manage-type-title').textContent = name;

  const { data: template } = await sb.from('equipment_type_pm_templates').select('*').eq('equipment_type_id', typeId).limit(1).maybeSingle();
  document.getElementById('type-template-title').value = template?.title || '';
  document.getElementById('type-template-interval').value = template?.interval_days || 180;
  document.getElementById('type-template-reminder').value = template?.reminder_days_before || '';

  await refreshTypeTemplateItems();
}

export function backToTypesList() {
  document.getElementById('manage-types-detail-view').classList.add('hidden');
  document.getElementById('manage-types-list-view').classList.remove('hidden');
  loadEquipmentTypesList();
}

async function getOrCreateTemplateId() {
  const { data } = await sb.from('equipment_type_pm_templates').select('id').eq('equipment_type_id', currentTypeId).limit(1).maybeSingle();
  return data?.id || null;
}

export async function saveTypeTemplateMeta() {
  const title = document.getElementById('type-template-title').value.trim();
  const interval_days = parseInt(document.getElementById('type-template-interval').value, 10);
  const reminder_days_before = document.getElementById('type-template-reminder').value || null;
  if (!title || !interval_days) { toast('Title and interval required', 'err'); return; }

  const existingId = await getOrCreateTemplateId();
  if (existingId) {
    const { error } = await sb.from('equipment_type_pm_templates').update({ title, interval_days, reminder_days_before }).eq('id', existingId);
    if (error) { toast(error.message, 'err'); return; }
  } else {
    const { error } = await sb.from('equipment_type_pm_templates').insert({ equipment_type_id: currentTypeId, title, interval_days, reminder_days_before });
    if (error) { toast(error.message, 'err'); return; }
  }
  toast('Template saved');
}

export function toggleNewTypeItemUnit() {
  const isReading = document.getElementById('new-type-item-type').value === 'reading';
  document.getElementById('new-type-item-unit').style.display = isReading ? '' : 'none';
}

async function refreshTypeTemplateItems() {
  const box = document.getElementById('type-template-items');
  const templateId = await getOrCreateTemplateId();
  if (!templateId) { box.innerHTML = '<div class="card-meta">Save the template above first.</div>'; return; }
  const { data } = await sb.from('equipment_type_pm_template_items').select('id, description, item_type, unit').eq('template_id', templateId).order('sort_order');
  if (!data || !data.length) { box.innerHTML = '<div class="card-meta">No checklist items yet.</div>'; return; }
  box.innerHTML = data.map(i => `
    <div class="checklist-item">
      <i data-lucide="${i.item_type === 'reading' ? 'gauge' : 'minus'}" style="width:12px; color:var(--text-muted); margin-top:2px;"></i>
      <span style="flex:1;">${escapeHtml(i.description)}${i.item_type === 'reading' ? ` <span class="card-meta">(${escapeHtml(i.unit || '')})</span>` : ''}</span>
      <button class="ghost" style="padding:2px 6px;" onclick="window.deleteTypeTemplateItem(${i.id})"><i data-lucide="trash-2" style="width:12px; color:var(--red);"></i></button>
    </div>
  `).join('');
  lucide.createIcons({ root: box });
}

export async function addTypeTemplateItem() {
  const description = document.getElementById('new-type-item-desc').value.trim();
  if (!description) return;
  const item_type = document.getElementById('new-type-item-type').value;
  const unitInput = document.getElementById('new-type-item-unit');
  const unit = item_type === 'reading' ? unitInput.value.trim() : null;
  if (item_type === 'reading' && !unit) { toast('Enter a unit for readings', 'err'); return; }

  const templateId = await getOrCreateTemplateId();
  if (!templateId) { toast('Save the template above first', 'err'); return; }

  const { error } = await sb.from('equipment_type_pm_template_items').insert({ template_id: templateId, description, item_type, unit });
  if (error) { toast(error.message, 'err'); return; }
  document.getElementById('new-type-item-desc').value = '';
  unitInput.value = '';
  refreshTypeTemplateItems();
}

export async function deleteTypeTemplateItem(itemId) {
  await sb.from('equipment_type_pm_template_items').delete().eq('id', itemId);
  refreshTypeTemplateItems();
}

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

  const { data: asset } = await sb.from('assets').select('category, name, location, criticality').eq('id', assetId).single();
  catSelect.value = asset?.category || '';

  const nameEl = document.getElementById('manage-asset-name');
  const locEl = document.getElementById('manage-asset-location');
  const critEl = document.getElementById('manage-asset-criticality');
  nameEl.value = asset?.name || '';
  locEl.value = asset?.location || '';
  critEl.value = asset?.criticality || '';
  nameEl.disabled = locEl.disabled = critEl.disabled = !canWrite;

  document.getElementById('manage-add-spec-row').classList.toggle('hidden', !canWrite);
  await refreshManageSpecs(canWrite);
}

export async function saveManageAssetField(field, value) {
  if (field === 'name' && !value.trim()) { toast('Name cannot be empty', 'err'); return; }
  const { error } = await sb.from('assets').update({ [field]: value }).eq('id', currentManageAssetId);
  if (error) { toast(error.message, 'err'); return; }
  toast('Saved');
  if (field === 'name') document.getElementById('manage-asset-title').textContent = value;
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
