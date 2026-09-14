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
  toast('Template saved — title/interval synced to every linked machine');
}

export function toggleNewTypeItemUnit() {
  const isReading = document.getElementById('new-type-item-type').value === 'reading';
  document.getElementById('new-type-item-unit').style.display = isReading ? '' : 'none';
}

let cachedTemplateItems = [];
let editingTemplateItemId = null;

async function refreshTypeTemplateItems() {
  const box = document.getElementById('type-template-items');
  const templateId = await getOrCreateTemplateId();
  if (!templateId) { box.innerHTML = '<div class="card-meta">Save the template above first.</div>'; return; }
  const { data } = await sb.from('equipment_type_pm_template_items').select('id, description, item_type, unit, section, tool, sort_order').eq('template_id', templateId).order('sort_order');
  cachedTemplateItems = data || [];
  editingTemplateItemId = null;
  renderTypeTemplateItems();
}

// Renders from the cache so toggling edit mode on one row doesn't require a
// re-fetch. Groups items by section (e.g. ISOLATION, MAIN MOTOR). Every add/edit/delete
// here is live-linked and propagates via DB triggers.
function renderTypeTemplateItems() {
  const box = document.getElementById('type-template-items');
  if (!cachedTemplateItems.length) { box.innerHTML = '<div class="card-meta">No checklist items yet.</div>'; return; }

  // Group by section
  const sectionMap = new Map();
  cachedTemplateItems.forEach(i => {
    const sec = (i.section && i.section.trim()) ? i.section.trim() : 'General';
    if (!sectionMap.has(sec)) sectionMap.set(sec, []);
    sectionMap.get(sec).push(i);
  });

  box.innerHTML = Array.from(sectionMap.entries()).map(([secName, items]) => `
    <div style="margin-bottom:14px; background:var(--bg); border:1px solid var(--border); border-radius:8px; overflow:hidden;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(255,255,255,0.03); border-bottom:1px solid var(--border);">
        <span style="font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-muted);">
          <i data-lucide="folder" style="width:12px; display:inline-block; vertical-align:-1px; margin-right:4px;"></i> ${escapeHtml(secName)} (${items.length})
        </span>
        <button class="ghost" style="padding:2px 8px; font-size:11px; border:1px solid var(--border);" onclick="window.prefillTypeItemSection('${escapeHtml(secName)}')">
          <i data-lucide="plus" style="width:11px;"></i> Add to section
        </button>
      </div>
      <div style="padding:0 10px;">
        ${items.map(i => {
          if (i.id === editingTemplateItemId) {
            return `
              <div class="checklist-item" style="gap:6px; flex-wrap:wrap; padding:8px 0;">
                <input id="edit-type-item-sec-${i.id}" placeholder="Section" value="${escapeHtml(i.section || '')}" style="width:130px;">
                <input id="edit-type-item-desc-${i.id}" value="${escapeHtml(i.description)}" style="flex:1; min-width:160px;">
                <select id="edit-type-item-type-${i.id}" style="width:auto;" onchange="window.toggleEditTypeItemUnit(${i.id})">
                  <option value="check" ${i.item_type === 'check' ? 'selected' : ''}>Check</option>
                  <option value="reading" ${i.item_type === 'reading' ? 'selected' : ''}>Reading</option>
                </select>
                <input id="edit-type-item-unit-${i.id}" placeholder="unit" value="${escapeHtml(i.unit || '')}" style="width:64px; display:${i.item_type === 'reading' ? '' : 'none'};">
                <input id="edit-type-item-tool-${i.id}" placeholder="Tool" value="${escapeHtml(i.tool || '')}" style="width:110px;">
                <button class="ghost" style="padding:2px 6px;" onclick="window.saveTypeTemplateItem(${i.id})"><i data-lucide="check" style="width:12px; color:var(--green);"></i></button>
                <button class="ghost" style="padding:2px 6px;" onclick="window.cancelEditTypeTemplateItem()"><i data-lucide="x" style="width:12px;"></i></button>
              </div>`;
          }
          return `
            <div class="checklist-item" style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.04);">
              <i data-lucide="${i.item_type === 'reading' ? 'gauge' : 'minus'}" style="width:12px; color:var(--text-muted); flex-shrink:0;"></i>
              <div style="flex:1; min-width:0;">
                <span style="color:var(--text); font-size:13.5px;">${escapeHtml(i.description)}</span>
                ${i.item_type === 'reading' ? ` <span class="card-meta">(${escapeHtml(i.unit || '')})</span>` : ''}
                ${i.tool ? ` <span class="pm-tool-chip">🔧 ${escapeHtml(i.tool)}</span>` : ''}
              </div>
              <button class="ghost" style="padding:2px 6px;" onclick="window.startEditTypeTemplateItem(${i.id})"><i data-lucide="pencil" style="width:12px;"></i></button>
              <button class="ghost" style="padding:2px 6px;" onclick="window.deleteTypeTemplateItem(${i.id})"><i data-lucide="trash-2" style="width:12px; color:var(--red);"></i></button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
  lucide.createIcons({ root: box });
}

export function prefillTypeItemSection(secName) {
  const input = document.getElementById('new-type-item-section');
  if (input) {
    input.value = secName === 'General' ? '' : secName;
    document.getElementById('new-type-item-desc')?.focus();
  }
}

export function startEditTypeTemplateItem(itemId) {
  editingTemplateItemId = itemId;
  renderTypeTemplateItems();
}

export function cancelEditTypeTemplateItem() {
  editingTemplateItemId = null;
  renderTypeTemplateItems();
}

export function toggleEditTypeItemUnit(itemId) {
  const isReading = document.getElementById(`edit-type-item-type-${itemId}`).value === 'reading';
  document.getElementById(`edit-type-item-unit-${itemId}`).style.display = isReading ? '' : 'none';
}

export async function saveTypeTemplateItem(itemId) {
  const description = document.getElementById(`edit-type-item-desc-${itemId}`).value.trim();
  if (!description) { toast('Description required', 'err'); return; }
  const section = document.getElementById(`edit-type-item-sec-${itemId}`)?.value.trim() || null;
  const tool = document.getElementById(`edit-type-item-tool-${itemId}`)?.value.trim() || null;
  const item_type = document.getElementById(`edit-type-item-type-${itemId}`).value;
  const unitInput = document.getElementById(`edit-type-item-unit-${itemId}`);
  const unit = item_type === 'reading' ? unitInput.value.trim() : null;
  if (item_type === 'reading' && !unit) { toast('Enter a unit for readings', 'err'); return; }

  const { error } = await sb.from('equipment_type_pm_template_items').update({
    description,
    item_type,
    unit,
    section,
    tool
  }).eq('id', itemId);
  if (error) { toast(error.message, 'err'); return; }
  toast('Task updated — synced to every linked machine');
  editingTemplateItemId = null;
  refreshTypeTemplateItems();
}

export async function addTypeTemplateItem() {
  const description = document.getElementById('new-type-item-desc').value.trim();
  if (!description) return;
  const sectionInput = document.getElementById('new-type-item-section');
  const section = sectionInput ? sectionInput.value.trim() || null : null;
  const toolInput = document.getElementById('new-type-item-tool');
  const tool = toolInput ? toolInput.value.trim() || null : null;
  const item_type = document.getElementById('new-type-item-type').value;
  const unitInput = document.getElementById('new-type-item-unit');
  const unit = item_type === 'reading' ? unitInput.value.trim() : null;
  if (item_type === 'reading' && !unit) { toast('Enter a unit for readings', 'err'); return; }

  const templateId = await getOrCreateTemplateId();
  if (!templateId) { toast('Save the template above first', 'err'); return; }

  const { error } = await sb.from('equipment_type_pm_template_items').insert({
    template_id: templateId,
    description,
    item_type,
    unit,
    section,
    tool
  });
  if (error) { toast(error.message, 'err'); return; }
  document.getElementById('new-type-item-desc').value = '';
  unitInput.value = '';
  if (toolInput) toolInput.value = '';
  toast('Task added — synced to every linked machine');
  refreshTypeTemplateItems();
}

export async function deleteTypeTemplateItem(itemId) {
  const { error } = await sb.from('equipment_type_pm_template_items').delete().eq('id', itemId);
  if (error) { toast(error.message, 'err'); return; }
  toast('Task removed from template and every linked machine');
  refreshTypeTemplateItems();
}

let currentManageAssetId = null;
let cachedManageAssets = [];
let manageAssetFilter = 'all';

export function setManageAssetFilter(filter) {
  manageAssetFilter = filter;
  document.querySelectorAll('[data-manage-filter]').forEach(b => {
    b.classList.toggle('active', b.dataset.manageFilter === filter);
  });
  renderManageAssetTable();
}

export function filterManageAssets() {
  renderManageAssetTable();
}

export function renderManageAssetTable() {
  const container = document.getElementById('manage-asset-list');
  const countEl = document.getElementById('manage-asset-count');
  if (!container) return;

  const search = (document.getElementById('manage-asset-search')?.value || '').trim().toLowerCase();

  let list = cachedManageAssets || [];
  if (manageAssetFilter === 'p1-p2') {
    list = list.filter(a => a.criticality === 'P1' || a.criticality === 'P2');
  } else if (manageAssetFilter === 'down') {
    list = list.filter(a => a.status === 'down');
  }

  if (search) {
    list = list.filter(a =>
      (a.name && a.name.toLowerCase().includes(search)) ||
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
    const dotCls = a.status === 'down' ? 'down' : a.status === 'maintenance' ? 'maintenance' : '';
    const dotTitle = a.status === 'down' ? 'Down (Open breakdown)' : a.status === 'maintenance' ? 'Under maintenance (Open PM)' : 'Running';
    const critCls = a.criticality ? `crit-${a.criticality.toLowerCase()}` : '';
    const catFormatted = a.category ? escapeHtml(a.category.replace('_', ' ')) : '—';
    const locFormatted = a.location ? escapeHtml(a.location) : '—';
    const deptFormatted = a.department ? escapeHtml(a.department) : '—';
    const catTag = a.category ? `<span class="asset-class">${escapeHtml(a.category.toUpperCase().replace(/_/g, ''))}</span>` : '';

    return `
      <tr onclick="window.openManageAsset(${a.id}, '${escapeHtml(a.name).replace(/'/g, "\\'")}')">
        <td>
          <div class="asset-cell">
            <span class="status-dot ${dotCls}" title="${dotTitle}"></span>
            <span class="asset-name">${escapeHtml(a.name)}</span>
            ${catTag}
          </div>
        </td>
        <td class="muted-cell">${catFormatted}</td>
        <td class="muted-cell">${locFormatted}</td>
        <td class="muted-cell">${deptFormatted}</td>
        <td>${a.criticality ? `<span class="crit ${critCls}">${escapeHtml(a.criticality)}</span>` : '<span class="card-meta">—</span>'}</td>
        <td class="row-actions" title="Edit asset">&#8942;</td>
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

export async function loadManageAssetList() {
  const list = document.getElementById('manage-asset-list');
  list.innerHTML = getLoaderHtml('Loading assets...');

  const [assetsRes, breakdownWosRes, pmWosRes] = await Promise.all([
    sb.from('assets').select('id, name, location, department, criticality, category').order('name'),
    sb.from('work_orders').select('asset_id').eq('type', 'breakdown').in('status', ['open', 'in_progress']),
    sb.from('work_orders').select('asset_id').eq('type', 'pm').in('status', ['open', 'in_progress']),
  ]);

  if (assetsRes.error) {
    list.innerHTML = `<div class="readout-empty">${assetsRes.error.message}</div>`;
    return;
  }
  if (!assetsRes.data || !assetsRes.data.length) {
    list.innerHTML = '<div class="readout-empty">No assets yet.</div>';
    const countEl = document.getElementById('manage-asset-count');
    if (countEl) countEl.textContent = '0 assets';
    return;
  }

  const downSet = new Set((breakdownWosRes.data || []).map(w => w.asset_id));
  const pmSet = new Set((pmWosRes.data || []).map(w => w.asset_id));

  cachedManageAssets = (assetsRes.data || []).map(a => ({
    ...a,
    status: downSet.has(a.id) ? 'down' : pmSet.has(a.id) ? 'maintenance' : 'running'
  }));

  renderManageAssetTable();
}

window.setManageAssetFilter = setManageAssetFilter;
window.filterManageAssets = filterManageAssets;


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

  const { data: asset } = await sb.from('assets').select('category, name, location, department, criticality').eq('id', assetId).single();
  catSelect.value = asset?.category || '';

  const nameEl = document.getElementById('manage-asset-name');
  const locEl = document.getElementById('manage-asset-location');
  const deptEl = document.getElementById('manage-asset-department');
  const critEl = document.getElementById('manage-asset-criticality');
  nameEl.value = asset?.name || '';
  locEl.value = asset?.location || '';
  deptEl.value = asset?.department || '';
  critEl.value = asset?.criticality || '';
  nameEl.disabled = locEl.disabled = deptEl.disabled = critEl.disabled = !canWrite;

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
