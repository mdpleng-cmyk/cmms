// assetSpecs.js
// CRUD + rendering for the free-form nameplate/spec fields on an asset.

import { sb, escapeHtml, toast } from './store.js';

export async function getAssetSpecs(assetId) {
  const { data, error } = await sb
    .from('asset_specs')
    .select('*')
    .eq('asset_id', assetId)
    .order('sort_order', { ascending: true });
  if (error) {
    toast('Could not load specs', 'err');
    throw error;
  }
  return data;
}

export async function addAssetSpec(assetId, { label, value = null, unit = null, sortOrder = 0 }) {
  const { data, error } = await sb
    .from('asset_specs')
    .insert({ asset_id: assetId, label, value, unit, sort_order: sortOrder })
    .select()
    .single();
  if (error) {
    toast('Could not add spec', 'err');
    throw error;
  }
  return data;
}

export async function updateAssetSpec(specId, fields) {
  // fields: any subset of { label, value, unit, sort_order }
  const { data, error } = await sb
    .from('asset_specs')
    .update(fields)
    .eq('id', specId)
    .select()
    .single();
  if (error) {
    toast('Could not update spec', 'err');
    throw error;
  }
  return data;
}

export async function deleteAssetSpec(specId) {
  const { error } = await sb.from('asset_specs').delete().eq('id', specId);
  if (error) {
    toast('Could not delete spec', 'err');
    throw error;
  }
}

/**
 * Renders the .spec-list <li> rows for a set of specs.
 * Matches the markup/classes already in your CSS (spec-list, k, v, v.mono).
 * `editable` adds a small edit affordance per row — wire its click handler
 * in app.js the same way you already do for other inline onclicks.
 */
export function renderSpecList(specs, { editable = false } = {}) {
  if (!specs.length) {
    return `<li class="readout-empty" style="padding:16px 0;">No specs added yet.</li>`;
  }
  return specs.map(s => `
    <li data-spec-id="${s.id}">
      <span class="k">${escapeHtml(s.label)}</span>
      <span class="v mono">
        ${escapeHtml(s.value ?? '—')}${s.unit ? ' ' + escapeHtml(s.unit) : ''}
        ${editable ? `<button class="ghost" style="padding:2px 6px;font-size:11px;" onclick="editAssetSpec('${s.id}')">Edit</button>` : ''}
      </span>
    </li>
  `).join('');
}
