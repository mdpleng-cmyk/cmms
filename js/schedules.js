import { sb, state, toast, setButtonLoading, getLoaderHtml, escapeHtml } from './store.js';

const pmGenerationInFlight = new Set();
const pmCompletionHandled = new Set();

let modalScheduleDraftItems = [];

export function resetModalDraftItems() {
  modalScheduleDraftItems = [];
  renderModalDraftItems();
  const descEl = document.getElementById('modal-task-desc');
  const secEl = document.getElementById('modal-task-section');
  const toolEl = document.getElementById('modal-task-tool');
  const unitEl = document.getElementById('modal-task-unit');
  const typeEl = document.getElementById('modal-task-type');
  if (descEl) descEl.value = '';
  if (secEl) secEl.value = '';
  if (toolEl) toolEl.value = '';
  if (unitEl) unitEl.value = '';
  if (typeEl) typeEl.value = 'check';
  toggleModalDraftItemUnit();
}

export function toggleModalDraftItemUnit() {
  const typeEl = document.getElementById('modal-task-type');
  const unitEl = document.getElementById('modal-task-unit');
  if (!typeEl || !unitEl) return;
  unitEl.classList.toggle('hidden', typeEl.value !== 'reading');
}

export function addDraftScheduleItem() {
  const descEl = document.getElementById('modal-task-desc');
  const desc = descEl ? descEl.value.trim() : '';
  if (!desc) {
    toast('Please enter a task description', 'err');
    if (descEl) descEl.focus();
    return;
  }
  const secEl = document.getElementById('modal-task-section');
  const section = secEl ? secEl.value.trim() || null : null;
  const toolEl = document.getElementById('modal-task-tool');
  const tool = toolEl ? toolEl.value.trim() || null : null;
  const typeEl = document.getElementById('modal-task-type');
  const item_type = typeEl ? typeEl.value : 'check';
  const unitEl = document.getElementById('modal-task-unit');
  const unit = item_type === 'reading' ? (unitEl ? unitEl.value.trim() : null) : null;
  if (item_type === 'reading' && !unit) {
    toast('Enter a unit for readings', 'err');
    return;
  }

  modalScheduleDraftItems.push({
    description: desc,
    item_type,
    unit,
    section,
    tool,
    sort_order: modalScheduleDraftItems.length + 1
  });

  if (descEl) descEl.value = '';
  if (toolEl) toolEl.value = '';
  if (unitEl) unitEl.value = '';
  renderModalDraftItems();
  toast('Task added to draft');
}

export function removeDraftScheduleItem(idx) {
  modalScheduleDraftItems.splice(idx, 1);
  modalScheduleDraftItems.forEach((it, i) => { it.sort_order = i + 1; });
  renderModalDraftItems();
}

export function renderModalDraftItems() {
  const listEl = document.getElementById('modal-sched-tasks-list');
  const countEl = document.getElementById('modal-sched-task-count');
  if (!listEl) return;

  if (countEl) {
    countEl.textContent = modalScheduleDraftItems.length
      ? `(${modalScheduleDraftItems.length} task${modalScheduleDraftItems.length !== 1 ? 's' : ''})`
      : '(Optional)';
  }

  if (!modalScheduleDraftItems.length) {
    listEl.innerHTML = '<div class="card-meta" style="font-size:12px; font-style:italic; padding:4px 0;">No tasks added yet. You can add them below or manage them later.</div>';
    return;
  }

  listEl.innerHTML = modalScheduleDraftItems.map((item, idx) => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 8px; background:var(--bg); border:1px solid var(--border); border-radius:4px; font-size:12px;">
      <div style="display:flex; align-items:center; gap:6px; overflow:hidden;">
        <span style="color:var(--text-muted); font-size:11px;">#${idx + 1}</span>
        ${item.section ? `<span style="font-size:10px; font-weight:700; color:var(--amber); text-transform:uppercase;">[${escapeHtml(item.section)}]</span>` : ''}
        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(item.description)}</span>
        ${item.item_type === 'reading' ? `<span class="card-meta">(${escapeHtml(item.unit || '')})</span>` : ''}
        ${item.tool ? `<span class="pm-tool-chip" style="font-size:10px; padding:1px 5px;">🔧 ${escapeHtml(item.tool)}</span>` : ''}
      </div>
      <button type="button" class="ghost" style="padding:2px 4px; color:var(--red); border:none; cursor:pointer;" onclick="window.removeDraftScheduleItem(${idx})">
        <i data-lucide="trash-2" style="width:12px;"></i>
      </button>
    </div>
  `).join('');

  lucide.createIcons({ root: listEl });
}

export function onSchedIntervalChange() {
  const targetValue = document.getElementById('sched-asset')?.value || '';
  if (targetValue.startsWith('type:')) return;
  const intervalVal = parseInt(document.getElementById('sched-interval')?.value, 10);
  if (!intervalVal || intervalVal <= 0) return;
  const d = new Date();
  d.setDate(d.getDate() + intervalVal);
  const dueInput = document.getElementById('sched-due');
  if (dueInput) dueInput.value = d.toISOString().split('T')[0];
}

export async function openNewScheduleForm(preselectedAssetId = null, preselectedAssetName = null) {
  const modal = document.getElementById('modal-pm-schedule');
  if (modal) modal.classList.remove('hidden');

  resetModalDraftItems();

  const titleInput = document.getElementById('sched-title');
  if (titleInput) titleInput.value = '';

  const intervalInput = document.getElementById('sched-interval');
  if (intervalInput) intervalInput.value = '30';

  const dueInput = document.getElementById('sched-due');
  const dueGroup = document.getElementById('sched-due-group');
  const dueNote = document.getElementById('sched-due-note');
  const preview = document.getElementById('sched-target-preview');
  const targetSelectorWrap = document.getElementById('sched-target-selector-wrap');
  const targetLockedWrap = document.getElementById('sched-target-locked');
  const headerEl = document.getElementById('modal-pm-sched-header');

  if (preview) {
    preview.classList.add('hidden');
    preview.innerHTML = '';
  }

  if (preselectedAssetId != null) {
    if (headerEl) headerEl.textContent = 'Create PM Schedule';
    if (targetSelectorWrap) targetSelectorWrap.classList.add('hidden');
    if (targetLockedWrap) targetLockedWrap.classList.remove('hidden');
    const lockedNameEl = document.getElementById('sched-locked-asset-name');
    if (lockedNameEl) lockedNameEl.textContent = preselectedAssetName || `Asset #${preselectedAssetId}`;

    const schedAsset = document.getElementById('sched-asset');
    if (schedAsset) {
      schedAsset.innerHTML = `<option value="asset:${preselectedAssetId}" selected>${escapeHtml(preselectedAssetName || '')}</option>`;
    }

    if (dueGroup) dueGroup.classList.remove('hidden');
    if (dueNote) dueNote.classList.add('hidden');
    if (dueInput) {
      dueInput.disabled = false;
      const d = new Date();
      d.setDate(d.getDate() + 30);
      dueInput.value = d.toISOString().split('T')[0];
    }
  } else {
    if (headerEl) headerEl.textContent = 'New PM Schedule';
    if (targetLockedWrap) targetLockedWrap.classList.add('hidden');
    if (targetSelectorWrap) targetSelectorWrap.classList.remove('hidden');

    // Fetch assets with their equipment type in one query
    const { data: assets } = await sb
      .from('assets')
      .select('id, name, equipment_type_id, equipment_types(id, name)')
      .order('name');

    // Build classes and individual asset options
    const typeMap = new Map();
    for (const a of (assets || [])) {
      if (a.equipment_type_id != null && a.equipment_types) {
        if (!typeMap.has(a.equipment_type_id)) {
          typeMap.set(a.equipment_type_id, a.equipment_types.name);
        }
      }
    }

    const sortedTypes = [...typeMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));

    const classOptions = sortedTypes.map(([id, name]) => `<option value="type:${id}">All ${escapeHtml(name)} Units (Class)</option>`);
    const assetOptions = (assets || []).map(a => {
      const typeLabel = a.equipment_types?.name ? ` [${a.equipment_types.name}]` : '';
      return `<option value="asset:${a.id}">${escapeHtml(a.name)}${typeLabel}</option>`;
    });

    const html = [];
    if (classOptions.length) {
      html.push(`<optgroup label="Equipment Classes (All units in class)">${classOptions.join('')}</optgroup>`);
    }
    if (assetOptions.length) {
      html.push(`<optgroup label="Individual Assets (Specific unit only)">${assetOptions.join('')}</optgroup>`);
    }

    const schedAsset = document.getElementById('sched-asset');
    if (schedAsset) {
      schedAsset.innerHTML = html.length ? html.join('') : '<option value="">No assets available</option>';
    }

    // Set initial field state to match the first option
    onPmTargetChange();
  }

  lucide.createIcons({ root: modal });
  setTimeout(() => titleInput?.focus(), 60);
}

export function closeNewScheduleForm() {
  const modal = document.getElementById('modal-pm-schedule');
  if (modal) modal.classList.add('hidden');
  resetModalDraftItems();
}

// Called by onchange on #sched-asset. Disables the date picker and shows a note
// when an equipment-type (class) target is selected, because the due date is
// calculated automatically per asset.
export async function onPmTargetChange() {
  const val      = document.getElementById('sched-asset').value;
  const dueInput = document.getElementById('sched-due');
  const dueNote  = document.getElementById('sched-due-note');
  const preview  = document.getElementById('sched-target-preview');
  const isClass  = val.startsWith('type:');
  if (dueInput) dueInput.disabled = isClass;
  if (isClass) {
    if (dueInput) dueInput.value = '';
    if (dueNote) dueNote.classList.remove('hidden');

    // Show asset preview for this class.
    const typeId = parseInt(val.slice(5), 10);
    if (preview) {
      preview.innerHTML = 'Loading assets…';
      preview.classList.remove('hidden');
      const { data: assets } = await sb.from('assets').select('name').eq('equipment_type_id', typeId).order('name');
      if (assets && assets.length) {
        preview.innerHTML = `<strong>Schedules will be created for ${assets.length} asset${assets.length !== 1 ? 's' : ''}:</strong> ` +
          assets.map(a => escapeHtml(a.name)).join(', ');
      } else {
        preview.innerHTML = 'No assets found for this equipment type.';
      }
    }
  } else {
    if (dueNote) dueNote.classList.add('hidden');
    if (preview) {
      preview.classList.add('hidden');
      preview.innerHTML = '';
    }
    const intervalVal = parseInt(document.getElementById('sched-interval')?.value, 10) || 30;
    if (dueInput && !dueInput.value) {
      const d = new Date();
      d.setDate(d.getDate() + intervalVal);
      dueInput.value = d.toISOString().split('T')[0];
    }
  }
}

export async function createSchedule() {
  const targetValue   = document.getElementById('sched-asset').value;
  const title         = document.getElementById('sched-title').value.trim();
  const interval_days = parseInt(document.getElementById('sched-interval').value, 10);

  if (!targetValue || !title || !interval_days || interval_days <= 0) {
    toast('Please fill all required fields with valid values', 'err');
    return;
  }

  // ── Standalone asset path ─────────────────────────────────────────────────
  if (!targetValue.startsWith('type:')) {
    const asset_id    = parseInt(targetValue.startsWith('asset:') ? targetValue.slice(6) : targetValue, 10);
    const next_due_at = document.getElementById('sched-due').value;
    if (!next_due_at) { toast('Please specify a first due date', 'err'); return; }

    setButtonLoading('btn-create-schedule', true);
    const { data: newSched, error: schedErr } = await sb
      .from('recurring_schedules')
      .insert({ asset_id, title, interval_days, next_due_at })
      .select()
      .single();

    if (schedErr) {
      toast(schedErr.message, 'err');
      setButtonLoading('btn-create-schedule', false);
      return;
    }

    // Insert drafted checklist tasks if any
    if (modalScheduleDraftItems.length > 0 && newSched) {
      const taskRows = modalScheduleDraftItems.map(item => ({
        schedule_id: newSched.id,
        description: item.description,
        item_type: item.item_type,
        unit: item.unit,
        section: item.section,
        tool: item.tool,
        sort_order: item.sort_order,
        template_item_id: null
      }));
      const { error: itemsErr } = await sb.from('checklist_items').insert(taskRows);
      if (itemsErr) {
        console.error('Error inserting draft checklist items:', itemsErr);
        toast('Schedule created, but some checklist tasks could not be saved', 'err');
      }
    }

    toast('PM schedule created successfully');
    closeNewScheduleForm();
    setButtonLoading('btn-create-schedule', false);

    // If Asset Profile modal is currently open for this asset, refresh its PM tab immediately!
    const assetModal = document.getElementById('asset-page');
    if (assetModal && !assetModal.classList.contains('hidden') && state.assetPageCurrent?.id === asset_id) {
      if (window.openAssetHistoryModal) {
        await window.openAssetHistoryModal(state.assetPageCurrent.id, state.assetPageCurrent.name, 'pm');
      }
    }

    loadSchedules();
    return;
  }

  // ── Equipment-type (class) path ───────────────────────────────────────────
  const type_id = parseInt(targetValue.slice(5), 10);

  // 1. Fetch every asset belonging to this equipment type.
  const { data: assets, error: assetsErr } = await sb
    .from('assets')
    .select('id, name, created_at')
    .eq('equipment_type_id', type_id)
    .order('name');

  if (assetsErr) { toast(assetsErr.message, 'err'); return; }
  if (!assets || !assets.length) { toast('No assets found for this equipment type', 'err'); return; }

  // 2. Bulk-check for duplicates.
  const assetIds = assets.map(a => a.id);
  const { data: existing } = await sb
    .from('recurring_schedules')
    .select('asset_id')
    .in('asset_id', assetIds)
    .eq('title', title)
    .eq('interval_days', interval_days);

  const alreadyHave = new Set((existing || []).map(s => s.asset_id));
  const toCreate    = assets.filter(a => !alreadyHave.has(a.id));
  const skipped     = assets.length - toCreate.length;

  if (!toCreate.length) {
    toast(`0 schedules created, ${skipped} skipped (already exist)`);
    return;
  }

  // 3. Build insert rows.
  const rows = toCreate.map(asset => {
    const c   = new Date(asset.created_at);
    const y   = c.getUTCFullYear();
    const mo  = String(c.getUTCMonth() + 1).padStart(2, '0');
    const d   = String(c.getUTCDate()).padStart(2, '0');
    const base = new Date(`${y}-${mo}-${d}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + interval_days);
    return { asset_id: asset.id, title, interval_days, next_due_at: base.toISOString().slice(0, 10) };
  });

  setButtonLoading('btn-create-schedule', true);
  const { data: insertedScheds, error: insertErr } = await sb
    .from('recurring_schedules')
    .insert(rows)
    .select();

  if (insertErr) {
    toast(insertErr.message, 'err');
    setButtonLoading('btn-create-schedule', false);
    return;
  }

  // 4. If drafted tasks exist, attach them to each newly created schedule
  if (modalScheduleDraftItems.length > 0 && insertedScheds && insertedScheds.length) {
    const allTaskRows = [];
    insertedScheds.forEach(sched => {
      modalScheduleDraftItems.forEach(item => {
        allTaskRows.push({
          schedule_id: sched.id,
          description: item.description,
          item_type: item.item_type,
          unit: item.unit,
          section: item.section,
          tool: item.tool,
          sort_order: item.sort_order,
          template_item_id: null
        });
      });
    });
    if (allTaskRows.length) {
      const { error: itemsErr } = await sb.from('checklist_items').insert(allTaskRows);
      if (itemsErr) console.error('Error attaching tasks to class schedules:', itemsErr);
    }
  }

  // 5. Report result.
  const created = toCreate.length;
  const parts   = [`${created} schedule${created !== 1 ? 's' : ''} created`];
  if (skipped) parts.push(`${skipped} skipped (already exist${skipped !== 1 ? '' : 's'})`);
  toast(parts.join(', '));

  closeNewScheduleForm();
  setButtonLoading('btn-create-schedule', false);
  loadSchedules();
}

let classPmGroups = {};
const expandedTileKeys = new Set();

function getSafeKey(key) {
  return 'pm-' + encodeURIComponent(key).replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function togglePmTile(safeKey) {
  const body = document.getElementById('pm-body-' + safeKey);
  const chevron = document.getElementById('pm-chevron-' + safeKey);
  if (!body) return;
  const isHidden = body.classList.contains('hidden');
  if (isHidden) {
    body.classList.remove('hidden');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    expandedTileKeys.add(safeKey);
  } else {
    body.classList.add('hidden');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    expandedTileKeys.delete(safeKey);
  }
  updateToggleAllButton();
}

export function toggleAllPmTiles() {
  const groupKeys = Object.keys(classPmGroups);
  if (!groupKeys.length) return;

  const allSafeKeys = groupKeys.map(k => getSafeKey(k));
  const allExpanded = allSafeKeys.every(k => expandedTileKeys.has(k));

  if (allExpanded) {
    expandedTileKeys.clear();
    allSafeKeys.forEach(k => {
      const body = document.getElementById('pm-body-' + k);
      const chevron = document.getElementById('pm-chevron-' + k);
      if (body) body.classList.add('hidden');
      if (chevron) chevron.style.transform = 'rotate(0deg)';
    });
  } else {
    allSafeKeys.forEach(k => {
      expandedTileKeys.add(k);
      const body = document.getElementById('pm-body-' + k);
      const chevron = document.getElementById('pm-chevron-' + k);
      if (body) body.classList.remove('hidden');
      if (chevron) chevron.style.transform = 'rotate(180deg)';
    });
  }
  updateToggleAllButton();
}

export function updateToggleAllButton() {
  const btn = document.getElementById('btn-toggle-all-pm');
  const label = document.getElementById('toggle-all-pm-label');
  const icon = document.getElementById('toggle-all-pm-icon');
  if (!btn || !label) return;

  const groupKeys = Object.keys(classPmGroups);
  if (!groupKeys.length) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-flex';

  const allSafeKeys = groupKeys.map(k => getSafeKey(k));
  const allExpanded = allSafeKeys.length > 0 && allSafeKeys.every(k => expandedTileKeys.has(k));

  if (allExpanded) {
    label.textContent = 'Collapse All';
    if (icon) icon.setAttribute('data-lucide', 'chevrons-up');
  } else {
    label.textContent = 'Expand All';
    if (icon) icon.setAttribute('data-lucide', 'chevrons-down');
  }
  lucide.createIcons({ root: btn });
}

export async function loadSchedules() {
  const list = document.getElementById('schedule-list');
  list.innerHTML = getLoaderHtml('Loading schedules...');
  
  const { data, error } = await sb.from('recurring_schedules').select('id, title, interval_days, next_due_at, active, asset_id, assets(name, equipment_types(name))').order('next_due_at');
  state.schedulesCache = data || [];
  
  if (error) { list.innerHTML = `<div class="readout-empty">${error.message}</div>`; return; }
  if (!state.schedulesCache.length) {
    list.innerHTML = '<div class="readout-empty"><i data-lucide="calendar-clock" style="width:32px;height:32px;"></i> No PM schedules yet.</div>';
    lucide.createIcons();
    updateToggleAllButton();
    return;
  }

  // Group schedules by equipment class + title
  classPmGroups = {};
  state.schedulesCache.forEach(s => {
    const typeName = s.assets?.equipment_types?.name;
    const key = typeName ? `${typeName}:::${s.title}` : `single:::${s.id}`;
    if (!classPmGroups[key]) {
      classPmGroups[key] = {
        key,
        typeName: typeName || null,
        title: s.title,
        interval_days: s.interval_days,
        schedules: []
      };
    }
    classPmGroups[key].schedules.push(s);
  });

  // Helper to render an individual schedule card (with checklist intact)
  const renderScheduleCard = (s, isSubCard = false, groupKey = null) => {
    const typeName = s.assets?.equipment_types?.name;
    const safeKey = getSafeKey(groupKey || ('single:::' + s.id));
    const isExpanded = expandedTileKeys.has(safeKey);

    if (isSubCard) {
      return `
      <div class="panel" id="schedule-card-${s.id}" style="background:var(--bg); border:1px solid var(--border); margin-bottom:0; padding:12px;">
        <div class="row" style="justify-content:space-between; margin-bottom:2px;">
          <div class="card-title" style="margin:0; font-size:14px;">${escapeHtml(s.title)} &mdash; <span style="font-size:13px; font-weight:500; color:var(--text);">${escapeHtml(s.assets?.name || 'Unknown')}</span></div>
          ${state.currentRole !== 'viewer' ? `<button class="ghost" style="padding:4px 8px; font-size:11px; border:1px solid var(--border);" onclick="window.generatePmWoNow(${s.id})"><i data-lucide="zap" style="width:12px;"></i> Generate WO Now</button>` : ''}
        </div>
        <div class="card-meta">
          <i data-lucide="server" style="width:12px; display:inline-block; vertical-align:-2px;"></i> ${escapeHtml(s.assets?.name || 'No asset')} &middot; 
          <i data-lucide="rotate-cw" style="width:12px; display:inline-block; vertical-align:-2px;"></i> ${s.interval_days}d &middot; 
          Due: ${s.next_due_at}
        </div>
        <div id="items-${s.id}" style="margin-top:10px"></div>
        ${state.currentRole !== 'viewer' ? `
          <div class="row" style="margin-top:12px">
            <input id="new-item-${s.id}" placeholder="Add task only to ${escapeHtml(s.assets?.name || 'this unit')}..." style="flex:1;">
            <select id="new-item-type-${s.id}" style="width:auto;" onchange="window.toggleNewItemUnit(${s.id})">
              <option value="check">Check</option>
              <option value="reading">Reading</option>
              <option value="text">Text / Condition</option>
            </select>
            <input id="new-item-unit-${s.id}" placeholder="unit" style="width:64px; display:none;">
            <button class="ghost" onclick="window.addChecklistItem(${s.id})" style="border:1px solid var(--border);"><i data-lucide="plus" style="width:14px;"></i></button>
          </div>` : ''}
      </div>`;
    }

    // Standalone (single) schedule card as top-level collapsible tile
    return `
    <div class="panel" id="schedule-card-${s.id}" style="margin-bottom:14px; padding:0; overflow:hidden;">
      <div class="pm-tile-header" onclick="window.togglePmTile('${safeKey}')">
        <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
          <i data-lucide="chevron-down" id="pm-chevron-${safeKey}" style="width:16px; min-width:16px; color:var(--text-muted); transition:transform 0.2s; transform:${isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'};"></i>
          <div style="min-width:0;">
            <div class="card-title" style="margin:0; font-size:15px;">${escapeHtml(s.title)}</div>
            <div class="card-meta" style="margin-top:3px;">
              <i data-lucide="server" style="width:12px; display:inline-block; vertical-align:-2px;"></i> ${escapeHtml(s.assets?.name || 'No asset')}${typeName ? ` <span class="badge" style="font-size:9px; vertical-align:1px;">${escapeHtml(typeName)}</span>` : ''} &middot; 
              <i data-lucide="rotate-cw" style="width:12px; display:inline-block; vertical-align:-2px;"></i> ${s.interval_days}d &middot; 
              Due: ${s.next_due_at}
            </div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;" onclick="event.stopPropagation()">
          ${state.currentRole !== 'viewer' ? `<button class="ghost" style="padding:4px 8px; font-size:11px; border:1px solid var(--border); white-space:nowrap;" onclick="window.generatePmWoNow(${s.id})"><i data-lucide="zap" style="width:12px;"></i> Generate WO Now</button>` : ''}
        </div>
      </div>
      <div id="pm-body-${safeKey}" class="${isExpanded ? '' : 'hidden'}" style="padding:0 16px 16px; border-top:1px solid var(--border);">
        <div id="items-${s.id}" style="margin-top:12px"></div>
        ${state.currentRole !== 'viewer' ? `
          <div class="row" style="margin-top:12px">
            <input id="new-item-${s.id}" placeholder="Add checklist item..." style="flex:1;">
            <select id="new-item-type-${s.id}" style="width:auto;" onchange="window.toggleNewItemUnit(${s.id})">
              <option value="check">Check</option>
              <option value="reading">Reading</option>
              <option value="text">Text / Condition</option>
            </select>
            <input id="new-item-unit-${s.id}" placeholder="unit" style="width:64px; display:none;">
            <button class="ghost" onclick="window.addChecklistItem(${s.id})" style="border:1px solid var(--border);"><i data-lucide="plus" style="width:14px;"></i></button>
          </div>` : ''}
      </div>
    </div>`;
  };

  list.innerHTML = Object.values(classPmGroups).map(group => {
    const isMultiUnitClass = group.typeName && group.schedules.length > 1;
    if (!isMultiUnitClass) {
      return renderScheduleCard(group.schedules[0], false, group.key);
    }

    const safeKey = getSafeKey(group.key);
    const isExpanded = expandedTileKeys.has(safeKey);
    const earliestDue = group.schedules.map(s => s.next_due_at).sort()[0] || '';
    const pluralClass = group.typeName
      ? (group.typeName.endsWith('s') || group.typeName.endsWith('S') ? group.typeName : group.typeName + 's')
      : 'units';

    return `
      <div class="panel class-pm-group" id="pm-tile-${safeKey}" style="margin-bottom:14px; border-left: 3px solid var(--amber); padding:0; overflow:hidden;">
        <!-- Group Header (clickable to collapse/expand) -->
        <div class="pm-tile-header" onclick="window.togglePmTile('${safeKey}')">
          <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
            <i data-lucide="chevron-down" id="pm-chevron-${safeKey}" style="width:16px; min-width:16px; color:var(--text-muted); transition:transform 0.2s; transform:${isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'};"></i>
            <div style="min-width:0;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="badge open" style="font-size:10px; text-transform:uppercase;">${escapeHtml(group.typeName)}</span>
                <div class="card-title" style="margin:0; font-size:15px;">${escapeHtml(group.title)}</div>
              </div>
              <div class="card-meta" style="margin-top:3px;">
                ${group.schedules.length} units &middot; ${group.interval_days}d interval &middot; Earliest due: ${earliestDue}
              </div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;" onclick="event.stopPropagation()">
            ${state.currentRole !== 'viewer' ? `
              <button class="primary" style="padding:6px 12px; font-size:12px; white-space:nowrap;" onclick="window.openPickPmAssetModal('${escapeHtml(group.key)}')">
                <i data-lucide="zap" style="width:13px; vertical-align:-1px;"></i> Generate PM
              </button>` : ''}
          </div>
        </div>

        <!-- Group Body (collapsible) -->
        <div id="pm-body-${safeKey}" class="${isExpanded ? '' : 'hidden'}" style="padding:0 16px 16px; border-top:1px solid var(--border);">
          ${state.currentRole !== 'viewer' ? `
            <div class="row" style="margin-top:14px; margin-bottom:12px; padding:10px; background:var(--bg); border:1px dashed var(--border); border-radius:6px;">
              <input id="class-add-${group.schedules[0].id}-desc" placeholder="Add task to all ${group.schedules.length} ${escapeHtml(pluralClass)}..." style="flex:1;">
              <select id="class-add-${group.schedules[0].id}-type" style="width:auto;" onchange="window.toggleClassNewItemUnit('${escapeHtml(group.key)}')">
                <option value="check">Check</option>
                <option value="reading">Reading</option>
                <option value="text">Text / Condition</option>
              </select>
              <input id="class-add-${group.schedules[0].id}-unit" placeholder="unit" style="width:64px; display:none;">
              <button class="ghost" onclick="window.addChecklistItemToClass('${escapeHtml(group.key)}')" style="border:1px solid var(--border); white-space:nowrap;">
                <i data-lucide="plus" style="width:14px;"></i> Add to all ${escapeHtml(pluralClass)}
              </button>
            </div>` : ''}
          <!-- Individual schedules with checklists intact underneath -->
          <div style="display:flex; flex-direction:column; gap:12px; margin-top:12px;">
            ${group.schedules.map(s => renderScheduleCard(s, true, group.key)).join('')}
          </div>
        </div>
      </div>`;
  }).join('');

  lucide.createIcons();
  updateToggleAllButton();
  for (const s of state.schedulesCache) loadChecklistItems(s.id);
}

export function openPickPmAssetModal(groupKey) {
  const group = classPmGroups[groupKey];
  if (!group) return;
  if (group.schedules.length === 1) {
    generatePmWoNow(group.schedules[0].id);
    return;
  }

  document.getElementById('pick-pm-class-name').textContent = `${group.typeName} Class`;
  document.getElementById('pick-pm-title').textContent = group.title;

  const listEl = document.getElementById('pick-pm-asset-list');
  const today = new Date(); today.setHours(0,0,0,0);

  listEl.innerHTML = group.schedules.map(s => {
    const dueDate = new Date(s.next_due_at + 'T00:00:00');
    const diffDays = Math.round((dueDate - today) / 86400000);
    const dueLabel = diffDays < 0
      ? `<span style="color:var(--red); font-weight:500;">${Math.abs(diffDays)}d overdue</span>`
      : diffDays === 0
        ? `<span style="color:var(--amber); font-weight:500;">Due today</span>`
        : `<span style="color:var(--text-muted);">Due in ${diffDays}d (${s.next_due_at})</span>`;

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--bg); border:1px solid var(--border); border-radius:6px; cursor:pointer; transition:border-color 0.15s;"
           onmouseover="this.style.borderColor='var(--amber)'"
           onmouseout="this.style.borderColor='var(--border)'"
           onclick="window.closePickPmAssetModal(); window.generatePmWoNow(${s.id});">
        <div>
          <div style="font-weight:600; font-size:13.5px; color:var(--text);">${escapeHtml(s.assets?.name || 'Unknown asset')}</div>
          <div style="font-size:11.5px; margin-top:2px;">${dueLabel}</div>
        </div>
        <button class="primary" style="padding:4px 10px; font-size:11px; pointer-events:none;">
          <i data-lucide="zap" style="width:11px;"></i> Select
        </button>
      </div>`;
  }).join('');

  document.getElementById('modal-pick-pm-asset').classList.remove('hidden');
  lucide.createIcons({ root: document.getElementById('modal-pick-pm-asset') });
}

export function closePickPmAssetModal() {
  const modal = document.getElementById('modal-pick-pm-asset');
  if (modal) modal.classList.add('hidden');
}

// Toggles the unit input for the class-level "add task to all units" form.
// Mirrors toggleNewItemUnit() but keyed off the group's first schedule id,
// since the class-add inputs live once per group, not once per schedule.
export function toggleClassNewItemUnit(groupKey) {
  const group = classPmGroups[groupKey];
  if (!group) return;
  const idBase = 'class-add-' + group.schedules[0].id;
  const isReading = document.getElementById(idBase + '-type').value === 'reading';
  document.getElementById(idBase + '-unit').style.display = isReading ? '' : 'none';
}

// Adds one checklist task to every CURRENT schedule in an equipment-class PM
// group in a single click, for a one-off task you don't want in the class
// template (e.g. a fault-specific check for this batch only). This is
// separate from — and does NOT touch — equipment_type_pm_templates, so it
// will NOT apply to future new assets of this class and will NOT show up as
// a template item in Manage → Equipment Types. For a task that should be
// permanent for the class and auto-apply going forward, add it to the
// template in Manage → Equipment Types instead — that path is live-linked
// and propagates automatically (see the pm_template live-link migration).
// Schedules that already carry an active item with the same description
// (case-insensitive) are skipped here, so re-clicking after a partial
// failure is safe.
export async function addChecklistItemToClass(groupKey) {
  const group = classPmGroups[groupKey];
  if (!group) return;

  const idBase = 'class-add-' + group.schedules[0].id;
  const input  = document.getElementById(idBase + '-desc');
  const description = input.value.trim();
  if (!description) return;

  const item_type  = document.getElementById(idBase + '-type').value;
  const unitInput  = document.getElementById(idBase + '-unit');
  const unit       = item_type === 'reading' ? unitInput.value.trim() : null;
  if (item_type === 'reading' && !unit) { toast('Enter a unit for readings (e.g. bar, °C)', 'err'); return; }

  const scheduleIds = group.schedules.map(s => s.id);
  const { data: existingItems, error: existingErr } = await sb
    .from('checklist_items')
    .select('schedule_id, description')
    .in('schedule_id', scheduleIds)
    .eq('active', true);
  if (existingErr) { toast(existingErr.message, 'err'); return; }

  const already = new Set(
    (existingItems || [])
      .filter(i => i.description.trim().toLowerCase() === description.toLowerCase())
      .map(i => i.schedule_id)
  );
  const targets = scheduleIds.filter(id => !already.has(id));

  if (!targets.length) { toast('Every unit already has this task'); return; }

  const rows = targets.map(schedule_id => ({ schedule_id, description, item_type, unit }));
  const { error } = await sb.from('checklist_items').insert(rows);
  if (error) { toast(error.message, 'err'); return; }

  input.value = '';
  if (unitInput) unitInput.value = '';
  const skipped = scheduleIds.length - targets.length;
  toast(`Added to ${targets.length} unit${targets.length !== 1 ? '' : ''}` + (skipped ? `, ${skipped} already had it` : ''));

  for (const id of targets) loadChecklistItems(id);
}


export async function loadChecklistItems(scheduleId) {
  const box = document.getElementById('items-' + scheduleId);
  if (!box) return;
  const { data, error } = await sb.from('checklist_items')
    .select('id, description, item_type, unit, section, tool, sort_order')
    .eq('schedule_id', scheduleId)
    .eq('active', true)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('added_at', { ascending: true });

  if (error) {
    console.error('loadChecklistItems error for schedule', scheduleId, error);
    box.innerHTML = `<div class="card-meta" style="color:var(--red);">Error loading tasks: ${escapeHtml(error.message)}</div>`;
    return;
  }
  if (!data || !data.length) { box.innerHTML = '<div class="card-meta">No checklist tasks defined.</div>'; return; }

  const hasSections = data.some(i => i.section && i.section.trim());
  if (!hasSections) {
    box.innerHTML = data.map(i => `
      <div class="checklist-item" style="display:flex; align-items:center; gap:6px;">
        <i data-lucide="${i.item_type === 'reading' ? 'gauge' : i.item_type === 'text' ? 'file-text' : 'minus'}" style="width:12px; color:var(--text-muted); flex-shrink:0;"></i>
        <span style="flex:1;">${escapeHtml(i.description)}</span>
        ${i.item_type === 'reading' ? ` <span class="card-meta">(${escapeHtml(i.unit || '')})</span>` : ''}
        ${i.tool ? ` <span class="pm-tool-chip" style="font-size:10px; padding:1px 5px;">🔧 ${escapeHtml(i.tool)}</span>` : ''}
      </div>
    `).join('');
  } else {
    const groups = {};
    for (const item of data) {
      const sec = (item.section && item.section.trim()) ? item.section.trim() : 'General';
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push(item);
    }
    box.innerHTML = Object.entries(groups).map(([sec, items]) => `
      <div style="margin-top:6px; margin-bottom:6px;">
        <div style="font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-muted); margin-bottom:3px;">
          ${escapeHtml(sec)} <span style="font-weight:normal; opacity:0.7;">(${items.length})</span>
        </div>
        ${items.map(i => `
          <div class="checklist-item" style="display:flex; align-items:center; gap:6px; padding-left:6px;">
            <i data-lucide="${i.item_type === 'reading' ? 'gauge' : i.item_type === 'text' ? 'file-text' : 'minus'}" style="width:12px; color:var(--text-muted); flex-shrink:0;"></i>
            <span style="flex:1;">${escapeHtml(i.description)}</span>
            ${i.item_type === 'reading' ? ` <span class="card-meta">(${escapeHtml(i.unit || '')})</span>` : ''}
            ${i.tool ? ` <span class="pm-tool-chip" style="font-size:10px; padding:1px 5px;">🔧 ${escapeHtml(i.tool)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `).join('');
  }
  lucide.createIcons({ root: box });
}

export function toggleNewItemUnit(scheduleId) {
  const isReading = document.getElementById('new-item-type-' + scheduleId).value === 'reading';
  document.getElementById('new-item-unit-' + scheduleId).style.display = isReading ? '' : 'none';
}

export async function addChecklistItem(scheduleId) {
  const input = document.getElementById('new-item-' + scheduleId);
  const description = input.value.trim();
  if (!description) return;
  const item_type = document.getElementById('new-item-type-' + scheduleId).value;
  const unitInput = document.getElementById('new-item-unit-' + scheduleId);
  const unit = item_type === 'reading' ? unitInput.value.trim() : null;
  if (item_type === 'reading' && !unit) { toast('Enter a unit for readings (e.g. bar, °C)', 'err'); return; }
  const { error } = await sb.from('checklist_items').insert({ schedule_id: scheduleId, description, item_type, unit });
  if (error) { toast(error.message, 'err'); return; }
  input.value = '';
  unitInput.value = '';
  loadChecklistItems(scheduleId);
}

export function populateScheduleSelect(id) {
  const assetId = document.getElementById('wo-asset-value').value;
  const sel = document.getElementById(id);
  if (!assetId) { sel.innerHTML = '<option value="">Select an asset first</option>'; return; }
  
  sb.from('recurring_schedules').select('id, title').eq('asset_id', assetId).eq('active', true).then(({ data }) => {
    sel.innerHTML = (data && data.length) 
      ? data.map(s => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join('')
      : '<option value="">No PM schedules for this asset</option>';
  });
}

export async function advanceScheduleForCompletedPm(scheduleId, completedAt, completionKey) {
  if (!completedAt || Number.isNaN(new Date(completedAt).getTime())) {
    return { error: new Error('PM completion timestamp is required') };
  }
  if (completionKey && pmCompletionHandled.has(completionKey)) {
    return { error: null, alreadyHandled: true };
  }
  if (completionKey) pmCompletionHandled.add(completionKey);

  const { data: schedule, error: loadErr } = await sb.from('recurring_schedules')
    .select('id, interval_days')
    .eq('id', scheduleId)
    .single();
  if (loadErr) {
    if (completionKey) pmCompletionHandled.delete(completionKey);
    return { error: loadErr };
  }

  const nextDue = new Date(completedAt);
  nextDue.setUTCDate(nextDue.getUTCDate() + schedule.interval_days);
  const nextDueValue = nextDue.toISOString();
  const { error: updateErr } = await sb.from('recurring_schedules')
    .update({ next_due_at: nextDueValue })
    .eq('id', scheduleId);
  if (updateErr) {
    if (completionKey) pmCompletionHandled.delete(completionKey);
    return { error: updateErr };
  }

  const { data: updated, error: verifyErr } = await sb.from('recurring_schedules')
    .select('id, next_due_at')
    .eq('id', scheduleId)
    .single();
  if (verifyErr) {
    if (completionKey) pmCompletionHandled.delete(completionKey);
    return { error: verifyErr };
  }
  if (new Date(updated.next_due_at).getTime() !== nextDue.getTime()) {
    if (completionKey) pmCompletionHandled.delete(completionKey);
    return { error: new Error('Schedule due date did not change') };
  }

  {
    const cached = state.schedulesCache.find(item => item.id === scheduleId);
    if (cached) cached.next_due_at = nextDueValue;
  }
  return { error: null, next_due_at: nextDueValue };
}

export async function generatePmWoNow(scheduleId) {
  const schedule = state.schedulesCache.find(s => s.id === scheduleId);
  if (!schedule) { toast('Schedule not found', 'err'); return; }
  if (pmGenerationInFlight.has(scheduleId)) return;
  pmGenerationInFlight.add(scheduleId);

  try {
    const { data, error } = await sb.rpc('generate_pm_work_order', { p_schedule_id: scheduleId });
    if (error) { toast(error.message, 'err'); return; }
    const wo = Array.isArray(data) ? data[0] : data;
    if (!wo?.wo_id) { toast('PM work order generation returned no work order', 'err'); return; }

    toast('PM work order generated');
    window.switchTab('wo');
    window.openWoDetailModal(wo.wo_id);
  } finally {
    pmGenerationInFlight.delete(scheduleId);
  }
}
