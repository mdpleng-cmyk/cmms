import { sb, state, toast, escapeHtml, getLoaderHtml, setButtonLoading } from './store.js';
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

let currentTemplateId = null;
let cachedTypeTemplates = [];

export async function openManageType(typeId, name) {
  console.log('openManageType called with:', { typeId, name });
  currentTypeId = typeId;
  currentTemplateId = null;
  document.getElementById('manage-types-list-view').classList.add('hidden');
  document.getElementById('manage-types-detail-view').classList.remove('hidden');
  document.getElementById('manage-type-title').textContent = name;

  await loadTypeTemplates(typeId);
}

export function backToTypesList() {
  document.getElementById('manage-types-detail-view').classList.add('hidden');
  document.getElementById('manage-types-list-view').classList.remove('hidden');
  loadEquipmentTypesList();
}

async function loadTypeTemplates(typeId, selectId = null) {
  const { data: templates, error: tmplErr } = await sb.from('equipment_type_pm_templates')
    .select('*')
    .eq('equipment_type_id', typeId)
    .order('interval_days', { ascending: true })
    .order('id', { ascending: true });

  if (tmplErr) console.error('Error fetching templates:', tmplErr);
  cachedTypeTemplates = templates || [];

  if (selectId && cachedTypeTemplates.some(t => t.id === selectId)) {
    currentTemplateId = selectId;
  } else if (cachedTypeTemplates.length > 0) {
    currentTemplateId = cachedTypeTemplates[0].id;
  } else {
    currentTemplateId = null;
  }

  renderTypeTemplateTabs();
  syncActiveTemplateUI();
}

function renderTypeTemplateTabs() {
  const bar = document.getElementById('manage-type-templates-bar');
  if (!bar) return;

  const isCreatingNew = currentTemplateId === null && cachedTypeTemplates.length > 0;
  
  const tabsHtml = cachedTypeTemplates.map(t => {
    const isActive = t.id === currentTemplateId;
    return `
      <button type="button" class="pm-template-tab ${isActive ? 'active' : ''}" onclick="window.selectTypeTemplate(${t.id})">
        <i data-lucide="calendar-clock" style="width:13px;"></i>
        <span>${escapeHtml(t.title)}</span>
        <span class="tab-interval">${t.interval_days}d</span>
      </button>
    `;
  }).join('');

  const newTabHtml = `
    <button type="button" class="pm-template-tab ${isCreatingNew ? 'active' : ''}" onclick="window.startNewTypeTemplate()" style="${isCreatingNew ? '' : 'border-style:dashed; color:var(--text-muted);'}">
      <i data-lucide="plus" style="width:13px; color:var(--green);"></i>
      <span>${isCreatingNew ? 'New Routine (Unsaved)' : 'Add PM Routine'}</span>
    </button>
  `;

  bar.innerHTML = tabsHtml + newTabHtml;
  lucide.createIcons({ root: bar });
}

function syncActiveTemplateUI() {
  const activeTmpl = cachedTypeTemplates.find(t => t.id === currentTemplateId);
  const typeName = document.getElementById('manage-type-title')?.textContent || '';
  const titleInput = document.getElementById('type-template-title');
  const intervalInput = document.getElementById('type-template-interval');
  const reminderInput = document.getElementById('type-template-reminder');
  const deleteBtn = document.getElementById('btn-delete-type-template');
  const eyebrow = document.getElementById('type-template-eyebrow');

  if (activeTmpl) {
    if (eyebrow) eyebrow.textContent = `PM Routine: ${activeTmpl.title}`;
    if (titleInput) titleInput.value = activeTmpl.title || '';
    if (intervalInput) intervalInput.value = activeTmpl.interval_days || 180;
    if (reminderInput) reminderInput.value = activeTmpl.reminder_days_before || '';
    if (deleteBtn) deleteBtn.classList.remove('hidden');
    refreshTypeTemplateItems();
  } else {
    if (eyebrow) eyebrow.textContent = 'Create New PM Routine';
    if (titleInput) {
      titleInput.value = '';
      titleInput.placeholder = typeName ? `e.g. ${typeName} · 180d Electrical PM` : 'e.g. 180d Electrical PM';
    }
    if (intervalInput) intervalInput.value = 180;
    if (reminderInput) reminderInput.value = '';
    if (deleteBtn) deleteBtn.classList.add('hidden');
    const itemsBox = document.getElementById('type-template-items');
    if (itemsBox) {
      itemsBox.innerHTML = '<div class="card-meta" style="text-align:center; padding:24px 0;">Save this new PM routine above first, then add checklist items below.</div>';
    }
  }
}

export function selectTypeTemplate(templateId) {
  currentTemplateId = templateId;
  renderTypeTemplateTabs();
  syncActiveTemplateUI();
}

export function startNewTypeTemplate() {
  currentTemplateId = null;
  renderTypeTemplateTabs();
  syncActiveTemplateUI();
  const titleInput = document.getElementById('type-template-title');
  if (titleInput) titleInput.focus();
}

export async function deleteTypeTemplate() {
  if (!currentTemplateId) return;
  const tmpl = cachedTypeTemplates.find(t => t.id === currentTemplateId);
  const tmplTitle = tmpl?.title || 'this PM routine';

  const proceed = confirm(`Are you sure you want to delete the PM routine "${tmplTitle}"?\n\nThis will remove the template and unlink associated recurring schedules for this equipment class.`);
  if (!proceed) return;

  setButtonLoading('btn-delete-type-template', true, '<i data-lucide="loader-2" class="spin" style="width:12px;"></i> Deleting...');

  try {
    // 1. Unlink recurring schedules so foreign key constraint does not block
    await sb.from('recurring_schedules').update({ pm_template_id: null }).eq('pm_template_id', currentTemplateId);

    // 2. Delete template items
    await sb.from('equipment_type_pm_template_items').delete().eq('template_id', currentTemplateId);

    // 3. Delete the template itself
    const { error } = await sb.from('equipment_type_pm_templates').delete().eq('id', currentTemplateId);
    if (error) {
      toast('Failed to delete template: ' + error.message, 'err');
      setButtonLoading('btn-delete-type-template', false);
      return;
    }

    toast(`PM routine "${tmplTitle}" deleted`);
    setButtonLoading('btn-delete-type-template', false);
    await loadTypeTemplates(currentTypeId);
  } catch (err) {
    setButtonLoading('btn-delete-type-template', false);
    console.error('deleteTypeTemplate error:', err);
    toast(err.message || 'Failed to delete template', 'err');
  }
}

export async function saveTypeTemplateMeta() {
  console.log('saveTypeTemplateMeta called. currentTypeId:', currentTypeId, 'currentTemplateId:', currentTemplateId);
  if (!currentTypeId) {
    toast('Please select an equipment type first', 'err');
    return;
  }
  const title = document.getElementById('type-template-title')?.value.trim() || '';
  const intervalRaw = document.getElementById('type-template-interval')?.value.trim() || '';
  const interval_days = parseInt(intervalRaw, 10);
  const reminderRaw = document.getElementById('type-template-reminder')?.value.trim() || '';
  const reminder_days_before = reminderRaw ? parseInt(reminderRaw, 10) : null;

  if (!title) { toast('Template title required', 'err'); return; }
  if (!interval_days || Number.isNaN(interval_days)) { toast('Valid interval (days) required', 'err'); return; }

  setButtonLoading('btn-save-type-template', true);

  try {
    let savedId = currentTemplateId;
    if (currentTemplateId) {
      const { error } = await sb.from('equipment_type_pm_templates').update({
        title,
        interval_days,
        reminder_days_before
      }).eq('id', currentTemplateId);
      if (error) { toast(error.message, 'err'); setButtonLoading('btn-save-type-template', false); return; }
      toast('PM routine updated — synced to every linked machine');
    } else {
      const { data, error } = await sb.from('equipment_type_pm_templates').insert({
        equipment_type_id: currentTypeId,
        title,
        interval_days,
        reminder_days_before
      }).select('id').single();
      if (error) { toast(error.message, 'err'); setButtonLoading('btn-save-type-template', false); return; }
      savedId = data.id;
      toast('New PM routine created — auto-populated to all machines in this class!');
    }

    const saveBtn = document.getElementById('btn-save-type-template');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i data-lucide="check" style="width:14px;"></i> Saved!';
      lucide.createIcons({ root: saveBtn });
      setTimeout(() => {
        saveBtn.innerHTML = 'Save Template';
      }, 2000);
    }
    await loadTypeTemplates(currentTypeId, savedId);
  } catch (err) {
    setButtonLoading('btn-save-type-template', false);
    console.error('saveTypeTemplateMeta error:', err);
    toast(err.message || 'Failed to save template', 'err');
  }
}

export function toggleNewTypeItemUnit() {
  const isReading = document.getElementById('new-type-item-type').value === 'reading';
  document.getElementById('new-type-item-unit').style.display = isReading ? '' : 'none';
}

let cachedTemplateItems = [];
let editingTemplateItemId = null;
let draggedChecklistItemId = null;

async function refreshTypeTemplateItems() {
  const box = document.getElementById('type-template-items');
  if (!box) return;
  if (!currentTemplateId) {
    box.innerHTML = '<div class="card-meta" style="text-align:center; padding:24px 0;">Save this new PM routine above first, then add checklist items below.</div>';
    return;
  }
  const { data, error } = await sb.from('equipment_type_pm_template_items')
    .select('id, description, item_type, unit, section, tool, sort_order')
    .eq('template_id', currentTemplateId)
    .order('sort_order');
  if (error) {
    console.error('refreshTypeTemplateItems error:', error);
    box.innerHTML = `<div class="card-meta" style="color:var(--red);">Error loading items: ${escapeHtml(error.message)}</div>`;
    return;
  }
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
                  <option value="text" ${i.item_type === 'text' ? 'selected' : ''}>Text / Condition</option>
                </select>
                <input id="edit-type-item-unit-${i.id}" placeholder="unit" value="${escapeHtml(i.unit || '')}" style="width:64px; display:${i.item_type === 'reading' ? '' : 'none'};">
                <input id="edit-type-item-tool-${i.id}" placeholder="Tool" value="${escapeHtml(i.tool || '')}" style="width:110px;">
                <button class="ghost" style="padding:2px 6px;" onclick="window.saveTypeTemplateItem(${i.id})"><i data-lucide="check" style="width:12px; color:var(--green);"></i></button>
                <button class="ghost" style="padding:2px 6px;" onclick="window.cancelEditTypeTemplateItem()"><i data-lucide="x" style="width:12px;"></i></button>
              </div>`;
          }
          return `
            <div class="checklist-item pm-sortable-item" draggable="true" data-checklist-id="${i.id}" data-checklist-section="${escapeHtml(secName)}"
              ondragstart="window.startChecklistDrag(event, ${i.id})" ondragover="window.allowChecklistDrop(event)" ondrop="window.dropChecklistItem(event, ${i.id}, 'template')">
              <span class="pm-drag-handle" title="Drag to reorder" aria-label="Drag to reorder"><i data-lucide="grip-vertical" style="width:14px;"></i></span>
              <i data-lucide="${i.item_type === 'reading' ? 'gauge' : i.item_type === 'text' ? 'file-text' : 'minus'}" style="width:12px; color:var(--text-muted); flex-shrink:0;"></i>
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

export function startChecklistDrag(event, itemId) {
  draggedChecklistItemId = itemId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(itemId));
  event.currentTarget.classList.add('pm-dragging');
}

export function allowChecklistDrop(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

export async function dropChecklistItem(event, targetId, mode) {
  event.preventDefault();
  document.querySelectorAll('.pm-dragging').forEach(el => el.classList.remove('pm-dragging'));
  const sourceId = draggedChecklistItemId;
  draggedChecklistItemId = null;
  if (!sourceId || sourceId === targetId) return;

  const items = mode === 'template' ? cachedTemplateItems : cachedAssetScheduleItems;
  const source = items.find(item => item.id === sourceId);
  const target = items.find(item => item.id === targetId);
  if (!source || !target) return;
  if ((source.section || 'General') !== (target.section || 'General')) {
    toast('Move items within the same section', 'err');
    return;
  }

  const reordered = items.slice();
  const sourceIndex = reordered.findIndex(item => item.id === sourceId);
  const [moved] = reordered.splice(sourceIndex, 1);
  const targetIndex = reordered.findIndex(item => item.id === targetId);
  reordered.splice(targetIndex, 0, moved);
  reordered.forEach((item, index) => { item.sort_order = index + 1; });

  if (mode === 'template') {
    cachedTemplateItems = reordered;
    renderTypeTemplateItems();
  } else {
    cachedAssetScheduleItems = reordered;
    renderAssetScheduleItems();
  }

  const table = mode === 'template' ? 'equipment_type_pm_template_items' : 'checklist_items';
  const updates = reordered.map(item => sb.from(table).update({ sort_order: item.sort_order }).eq('id', item.id));
  const results = await Promise.all(updates);
  const failed = results.find(result => result.error);
  if (failed) {
    toast(failed.error.message || 'Failed to save checklist order', 'err');
    if (mode === 'template') refreshTypeTemplateItems();
    else refreshAssetScheduleItems();
    return;
  }
  toast('Checklist order saved');
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
  const descEl = document.getElementById('new-type-item-desc');
  const description = descEl ? descEl.value.trim() : '';
  console.log('addTypeTemplateItem called. description:', description, 'currentTypeId:', currentTypeId);
  if (!description) {
    toast('Please enter a task description', 'err');
    if (descEl) descEl.focus();
    return;
  }
  const sectionInput = document.getElementById('new-type-item-section');
  const section = sectionInput ? sectionInput.value.trim() || null : null;
  const toolInput = document.getElementById('new-type-item-tool');
  const tool = toolInput ? toolInput.value.trim() || null : null;
  const item_type = document.getElementById('new-type-item-type').value;
  const unitInput = document.getElementById('new-type-item-unit');
  const unit = item_type === 'reading' ? (unitInput ? unitInput.value.trim() : null) : null;
  if (item_type === 'reading' && !unit) { toast('Enter a unit for readings', 'err'); return; }

  setButtonLoading('btn-add-type-item', true);

  try {
    const templateId = currentTemplateId;
    if (!templateId) {
      toast('Save the PM routine above first', 'err');
      setButtonLoading('btn-add-type-item', false, '<i data-lucide="plus" style="width:14px;"></i> Add Item');
      return;
    }

    const nextSortOrder = (cachedTemplateItems && cachedTemplateItems.length)
      ? Math.max(...cachedTemplateItems.map(i => i.sort_order || 0)) + 1
      : 1;

    const payload = {
      template_id: templateId,
      description,
      item_type,
      unit,
      section,
      tool,
      sort_order: nextSortOrder
    };
    console.log('Inserting into equipment_type_pm_template_items:', payload);

    const { data, error } = await sb.from('equipment_type_pm_template_items').insert(payload).select();
    if (error) {
      console.error('Supabase insert error details:', error);
      toast(`${error.message}${error.details ? ` (${error.details})` : ''}`, 'err');
      setButtonLoading('btn-add-type-item', false, '<i data-lucide="plus" style="width:14px;"></i> Add Item');
      return;
    }
    console.log('Successfully inserted item:', data);
    if (descEl) descEl.value = '';
    if (unitInput) unitInput.value = '';
    if (toolInput) toolInput.value = '';
    toast('Task added — synced to every linked machine');
    setButtonLoading('btn-add-type-item', false, '<i data-lucide="plus" style="width:14px;"></i> Add Item');
    await refreshTypeTemplateItems();
  } catch (err) {
    setButtonLoading('btn-add-type-item', false, '<i data-lucide="plus" style="width:14px;"></i> Add Item');
    console.error('addTypeTemplateItem caught exception:', err);
    toast(err.message || 'Failed to add item', 'err');
  }
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
      (a.displayName && a.displayName.toLowerCase().includes(search)) ||
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

    const aName = a.displayName || a.name;
    return `
      <tr onclick="window.openManageAsset(${a.id}, '${escapeHtml(aName).replace(/'/g, "\\'")}')">
        <td>
          <div class="asset-cell">
            <span class="status-dot ${dotCls}" title="${dotTitle}"></span>
            <span class="asset-name">${escapeHtml(aName)}</span>
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
    sb.from('assets').select('id, name, location, department, criticality, category, equipment_types(name)').order('name'),
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

  cachedManageAssets = (assetsRes.data || []).map(a => {
    const className = a.equipment_types?.name;
    const displayName = className ? `${className} - ${a.name}` : a.name;
    return {
      ...a,
      displayName,
      status: downSet.has(a.id) ? 'down' : pmSet.has(a.id) ? 'maintenance' : 'running'
    };
  });

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
  await loadAssetSchedules(assetId);
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

// ─────────────────────────────────────────────────────────────────────────────
// Single-Asset PM Routines Management
// ─────────────────────────────────────────────────────────────────────────────

let currentAssetScheduleId = null;
let cachedAssetSchedules = [];
let cachedAssetScheduleItems = [];

export async function loadAssetSchedules(assetId, selectId = null) {
  const { data: schedules, error } = await sb.from('recurring_schedules')
    .select('*')
    .eq('asset_id', assetId)
    .eq('active', true)
    .order('interval_days', { ascending: true })
    .order('id', { ascending: true });

  if (error) console.error('loadAssetSchedules error:', error);
  cachedAssetSchedules = schedules || [];

  if (selectId && cachedAssetSchedules.some(s => s.id === selectId)) {
    currentAssetScheduleId = selectId;
  } else if (cachedAssetSchedules.length > 0) {
    currentAssetScheduleId = cachedAssetSchedules[0].id;
  } else {
    currentAssetScheduleId = null;
  }

  renderAssetScheduleTabs();
  syncActiveAssetScheduleUI();
}

function renderAssetScheduleTabs() {
  const bar = document.getElementById('manage-asset-schedules-bar');
  if (!bar) return;

  const isCreatingNew = currentAssetScheduleId === null && cachedAssetSchedules.length > 0;

  const tabsHtml = cachedAssetSchedules.map(s => {
    const isActive = s.id === currentAssetScheduleId;
    const isCustom = !s.pm_template_id;
    return `
      <button type="button" class="pm-template-tab ${isActive ? 'active' : ''}" onclick="window.selectAssetSchedule(${s.id})">
        <i data-lucide="${isCustom ? 'wrench' : 'calendar-clock'}" style="width:13px; ${isCustom ? 'color:var(--blue);' : ''}"></i>
        <span>${escapeHtml(s.title)}</span>
        <span class="tab-interval">${s.interval_days}d</span>
      </button>
    `;
  }).join('');

  const newTabHtml = `
    <button type="button" class="pm-template-tab ${isCreatingNew ? 'active' : ''}" onclick="window.startNewAssetSchedule()" style="${isCreatingNew ? '' : 'border-style:dashed; color:var(--text-muted);'}">
      <i data-lucide="plus" style="width:13px; color:var(--green);"></i>
      <span>${isCreatingNew ? 'New Routine (Unsaved)' : 'Add PM Routine'}</span>
    </button>
  `;

  bar.innerHTML = tabsHtml + newTabHtml;
  lucide.createIcons({ root: bar });
}

function syncActiveAssetScheduleUI() {
  const activeSched = cachedAssetSchedules.find(s => s.id === currentAssetScheduleId);
  const assetName = document.getElementById('manage-asset-title')?.textContent || '';
  const titleInput = document.getElementById('asset-sched-title');
  const intervalInput = document.getElementById('asset-sched-interval');
  const dueInput = document.getElementById('asset-sched-due');
  const reminderInput = document.getElementById('asset-sched-reminder');
  const deleteBtn = document.getElementById('btn-delete-asset-sched');
  const eyebrow = document.getElementById('asset-sched-eyebrow');
  const meta = document.getElementById('asset-sched-meta');

  if (activeSched) {
    if (eyebrow) eyebrow.textContent = `PM Routine: ${activeSched.title}`;
    if (meta) {
      meta.textContent = activeSched.pm_template_id
        ? 'This routine is linked from the equipment class template. Tasks added below will be preserved specifically for this unit.'
        : 'This routine is custom scheduled specifically for this unit.';
    }
    if (titleInput) titleInput.value = activeSched.title || '';
    if (intervalInput) intervalInput.value = activeSched.interval_days || 30;
    if (dueInput) dueInput.value = activeSched.next_due_at || '';
    if (reminderInput) reminderInput.value = activeSched.reminder_days_before || '';
    if (deleteBtn) deleteBtn.classList.remove('hidden');
    refreshAssetScheduleItems();
  } else {
    if (eyebrow) eyebrow.textContent = 'Create New PM Routine';
    if (meta) meta.textContent = 'Configure a new recurring PM routine specifically for this machine.';
    if (titleInput) {
      titleInput.value = '';
      titleInput.placeholder = assetName ? `e.g. ${assetName} · Daily Filter Inspection` : 'e.g. Daily Filter Inspection';
    }
    if (intervalInput) intervalInput.value = 30;
    
    // Default due date = today + 30 days
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 30);
    if (dueInput) dueInput.value = nextDate.toISOString().split('T')[0];

    if (reminderInput) reminderInput.value = '';
    if (deleteBtn) deleteBtn.classList.add('hidden');
    const itemsBox = document.getElementById('asset-sched-items');
    if (itemsBox) {
      itemsBox.innerHTML = '<div class="card-meta" style="text-align:center; padding:24px 0;">Save this new PM routine above first, then add checklist items below.</div>';
    }
  }
}

export function selectAssetSchedule(scheduleId) {
  currentAssetScheduleId = scheduleId;
  renderAssetScheduleTabs();
  syncActiveAssetScheduleUI();
}

export function startNewAssetSchedule() {
  currentAssetScheduleId = null;
  renderAssetScheduleTabs();
  syncActiveAssetScheduleUI();
  const titleInput = document.getElementById('asset-sched-title');
  if (titleInput) titleInput.focus();
}

export async function saveAssetScheduleMeta() {
  if (!currentManageAssetId) {
    toast('Please select an asset first', 'err');
    return;
  }
  const title = document.getElementById('asset-sched-title')?.value.trim() || '';
  const intervalRaw = document.getElementById('asset-sched-interval')?.value.trim() || '';
  const interval_days = parseInt(intervalRaw, 10);
  const next_due_at = document.getElementById('asset-sched-due')?.value || null;
  const reminderRaw = document.getElementById('asset-sched-reminder')?.value.trim() || '';
  const reminder_days_before = reminderRaw ? parseInt(reminderRaw, 10) : null;

  if (!title) { toast('Routine title required', 'err'); return; }
  if (!interval_days || Number.isNaN(interval_days)) { toast('Valid interval (days) required', 'err'); return; }
  if (!next_due_at) { toast('Next due date required', 'err'); return; }

  setButtonLoading('btn-save-asset-sched', true);

  try {
    let savedId = currentAssetScheduleId;
    if (currentAssetScheduleId) {
      const { error } = await sb.from('recurring_schedules').update({
        title,
        interval_days,
        next_due_at,
        reminder_days_before
      }).eq('id', currentAssetScheduleId);
      if (error) { toast(error.message, 'err'); setButtonLoading('btn-save-asset-sched', false); return; }
      toast('PM routine updated for this unit');
    } else {
      const { data, error } = await sb.from('recurring_schedules').insert({
        asset_id: currentManageAssetId,
        title,
        interval_days,
        next_due_at,
        reminder_days_before,
        pm_template_id: null
      }).select('id').single();
      if (error) { toast(error.message, 'err'); setButtonLoading('btn-save-asset-sched', false); return; }
      savedId = data.id;
      toast('New PM routine created for this unit!');
    }

    const saveBtn = document.getElementById('btn-save-asset-sched');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i data-lucide="check" style="width:14px;"></i> Saved!';
      lucide.createIcons({ root: saveBtn });
      setTimeout(() => {
        saveBtn.innerHTML = 'Save Routine';
      }, 2000);
    }
    await loadAssetSchedules(currentManageAssetId, savedId);
  } catch (err) {
    setButtonLoading('btn-save-asset-sched', false);
    console.error('saveAssetScheduleMeta error:', err);
    toast(err.message || 'Failed to save schedule', 'err');
  }
}

export async function deleteAssetSchedule() {
  if (!currentAssetScheduleId) return;
  const sched = cachedAssetSchedules.find(s => s.id === currentAssetScheduleId);
  const schedTitle = sched?.title || 'this PM routine';

  const proceed = confirm(`Are you sure you want to delete the PM routine "${schedTitle}" for this unit?\n\nThis will remove the schedule and its checklist items.`);
  if (!proceed) return;

  setButtonLoading('btn-delete-asset-sched', true, '<i data-lucide="loader-2" class="spin" style="width:12px;"></i> Deleting...');

  try {
    // Check if work orders exist for this schedule
    const { data: woCount } = await sb.from('work_orders').select('id').eq('schedule_id', currentAssetScheduleId).limit(1);
    if (woCount && woCount.length > 0) {
      // Soft disable instead of hard deleting to protect work order foreign key constraint
      const { error } = await sb.from('recurring_schedules').update({ active: false }).eq('id', currentAssetScheduleId);
      if (error) throw error;
      toast(`PM routine "${schedTitle}" disabled (historical Work Orders preserved)`);
    } else {
      // Hard delete items and schedule
      await sb.from('checklist_items').delete().eq('schedule_id', currentAssetScheduleId);
      const { error } = await sb.from('recurring_schedules').delete().eq('id', currentAssetScheduleId);
      if (error) throw error;
      toast(`PM routine "${schedTitle}" deleted`);
    }

    setButtonLoading('btn-delete-asset-sched', false);
    await loadAssetSchedules(currentManageAssetId);
  } catch (err) {
    setButtonLoading('btn-delete-asset-sched', false);
    console.error('deleteAssetSchedule error:', err);
    toast(err.message || 'Failed to delete schedule', 'err');
  }
}

export function toggleNewAssetItemUnit() {
  const isReading = document.getElementById('new-asset-item-type').value === 'reading';
  document.getElementById('new-asset-item-unit').style.display = isReading ? '' : 'none';
}

export async function refreshAssetScheduleItems() {
  const box = document.getElementById('asset-sched-items');
  if (!box) return;
  if (!currentAssetScheduleId) {
    box.innerHTML = '<div class="card-meta" style="text-align:center; padding:24px 0;">Save this new PM routine above first, then add checklist items below.</div>';
    return;
  }
  const { data, error } = await sb.from('checklist_items')
    .select('id, description, item_type, unit, section, tool, sort_order, template_item_id')
    .eq('schedule_id', currentAssetScheduleId)
    .eq('active', true)
    .order('sort_order');
  if (error) {
    console.error('refreshAssetScheduleItems error:', error);
    box.innerHTML = `<div class="card-meta" style="color:var(--red);">Error loading items: ${escapeHtml(error.message)}</div>`;
    return;
  }
  cachedAssetScheduleItems = data || [];
  renderAssetScheduleItems();
}

function renderAssetScheduleItems() {
  const box = document.getElementById('asset-sched-items');
  if (!cachedAssetScheduleItems.length) { box.innerHTML = '<div class="card-meta" style="padding:16px 0; text-align:center;">No checklist items yet for this schedule.</div>'; return; }

  const sectionMap = new Map();
  cachedAssetScheduleItems.forEach(i => {
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
        <button class="ghost" style="padding:2px 8px; font-size:11px; border:1px solid var(--border);" onclick="window.prefillAssetItemSection('${escapeHtml(secName)}')">
          <i data-lucide="plus" style="width:11px;"></i> Add to section
        </button>
      </div>
      <div style="padding:0 10px;">
        ${items.map(i => {
          const isInherited = !!i.template_item_id;
          return `
            <div class="checklist-item pm-sortable-item" draggable="true" data-checklist-id="${i.id}" data-checklist-section="${escapeHtml(secName)}"
              ondragstart="window.startChecklistDrag(event, ${i.id})" ondragover="window.allowChecklistDrop(event)" ondrop="window.dropChecklistItem(event, ${i.id}, 'asset')"
              style="padding:8px 0; display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
                <span class="pm-drag-handle" title="Drag to reorder" aria-label="Drag to reorder"><i data-lucide="grip-vertical" style="width:14px;"></i></span>
                <i data-lucide="${i.item_type === 'reading' ? 'gauge' : 'check-square'}" style="width:14px; color:var(--text-muted); flex-shrink:0;"></i>
                <div style="min-width:0;">
                  <div style="font-size:13px; color:var(--text);">${escapeHtml(i.description)} ${i.item_type === 'reading' ? `<span class="card-meta">(${escapeHtml(i.unit || '')})</span>` : ''}</div>
                  <div style="display:flex; gap:6px; align-items:center; margin-top:2px;">
                    ${i.tool ? `<span class="pm-tool-chip">🔧 ${escapeHtml(i.tool)}</span>` : ''}
                    ${isInherited ? `<span class="badge" style="font-size:9px; padding:1px 5px;">Class Template</span>` : `<span class="badge open" style="font-size:9px; padding:1px 5px;">Custom for Unit</span>`}
                  </div>
                </div>
              </div>
              <button class="ghost" style="padding:4px 8px; border:1px solid var(--border); color:var(--red);" onclick="window.deleteAssetScheduleItem(${i.id})">
                <i data-lucide="trash-2" style="width:13px;"></i>
              </button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');

  lucide.createIcons({ root: box });
}

export function prefillAssetItemSection(secName) {
  const secInput = document.getElementById('new-asset-item-section');
  if (secInput) secInput.value = secName;
  const descInput = document.getElementById('new-asset-item-desc');
  if (descInput) descInput.focus();
}

export async function addAssetScheduleItem() {
  const descEl = document.getElementById('new-asset-item-desc');
  const description = descEl ? descEl.value.trim() : '';
  if (!description) {
    toast('Please enter a task description', 'err');
    if (descEl) descEl.focus();
    return;
  }
  const sectionInput = document.getElementById('new-asset-item-section');
  const section = sectionInput ? sectionInput.value.trim() || null : null;
  const toolInput = document.getElementById('new-asset-item-tool');
  const tool = toolInput ? toolInput.value.trim() || null : null;
  const item_type = document.getElementById('new-asset-item-type').value;
  const unitInput = document.getElementById('new-asset-item-unit');
  const unit = item_type === 'reading' ? (unitInput ? unitInput.value.trim() : null) : null;
  if (item_type === 'reading' && !unit) { toast('Enter a unit for readings', 'err'); return; }

  setButtonLoading('btn-add-asset-item', true);

  try {
    const scheduleId = currentAssetScheduleId;
    if (!scheduleId) {
      toast('Save the PM routine above first', 'err');
      setButtonLoading('btn-add-asset-item', false, '<i data-lucide="plus" style="width:14px;"></i> Add Item');
      return;
    }

    const nextSortOrder = (cachedAssetScheduleItems && cachedAssetScheduleItems.length)
      ? Math.max(...cachedAssetScheduleItems.map(i => i.sort_order || 0)) + 1
      : 1;

    const payload = {
      schedule_id: scheduleId,
      description,
      item_type,
      unit,
      section,
      tool,
      sort_order: nextSortOrder,
      template_item_id: null
    };

    const { error } = await sb.from('checklist_items').insert(payload);
    if (error) {
      toast(error.message, 'err');
      setButtonLoading('btn-add-asset-item', false, '<i data-lucide="plus" style="width:14px;"></i> Add Item');
      return;
    }

    if (descEl) descEl.value = '';
    if (unitInput) unitInput.value = '';
    if (toolInput) toolInput.value = '';
    toast('Task added to this machine');
    setButtonLoading('btn-add-asset-item', false, '<i data-lucide="plus" style="width:14px;"></i> Add Item');
    await refreshAssetScheduleItems();
  } catch (err) {
    setButtonLoading('btn-add-asset-item', false, '<i data-lucide="plus" style="width:14px;"></i> Add Item');
    console.error('addAssetScheduleItem error:', err);
    toast(err.message || 'Failed to add item', 'err');
  }
}

export async function deleteAssetScheduleItem(itemId) {
  const { error } = await sb.from('checklist_items').delete().eq('id', itemId);
  if (error) { toast(error.message, 'err'); return; }
  toast('Task removed from this schedule');
  refreshAssetScheduleItems();
}
