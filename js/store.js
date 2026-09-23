const SUPABASE_URL = "https://eizyetgfrqlrlhvrxjsq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpenlldGdmcnFscmxodnJ4anNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMzMwMDUsImV4cCI6MjEwMzgwOTAwNX0.xYjQ5IF2SKYpiXQtxSvSLmT7dPwaHv8w9Z1kpNGdH_g";

// Capture recovery flag BEFORE createClient() — Supabase clears the hash/query
// during token exchange, so this must happen first.
const _hash = typeof window !== 'undefined' ? new URLSearchParams(window.location.hash.slice(1)) : new URLSearchParams();
const _search = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
export const isRecoveryLink = _hash.get('type') === 'recovery' || _search.get('type') === 'recovery';
export const urlHashType = _hash.get('type');

export const sb = typeof supabase !== 'undefined' ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Read-only link to the telemetry/meter-reading project — separate Supabase
// project, anonymous access confirmed open on latest_meter_readings + meters.
// Never used for writes; CMMS auth has no relationship to that project's auth.
export const sbTelemetry = supabase.createClient(
  'https://cyycyzwfeswnodpnhpdu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5eWN5endmZXN3bm9kcG5ocGR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxMjI2MTQsImV4cCI6MjEwMjY5ODYxNH0.WXMde2-K_roIqqhZvcTyi-O_dB1q0HvPzRRMpj6MzN4'
);

// Shared Global State
export const state = {
  currentUser: null,
  currentRole: null,
  currentUserFullName: '',
  usersCache: {},
  assetsCache: [],
  schedulesCache: [],
  activeWorkOrders: [],
  woToUpdate: null,
  woDetailCurrent: null,
  assetPageCurrent: null,
  assetStatusCache: {}
};

// { label, cls } for a P1-P4 (or null) priority value — used anywhere a
// priority badge is rendered, so the mapping stays in one place.
export function getAssetDisplayName(asset, assetId = null) {
  if (!asset && assetId && state.assetsCache && state.assetsCache.length) {
    const found = state.assetsCache.find(a => a.id === assetId);
    if (found) asset = found;
  }
  if (!asset) return '';
  if (typeof asset === 'string') {
    if (assetId == null && state.assetsCache && state.assetsCache.length) {
      const found = state.assetsCache.find(a => a.id === asset);
      if (found) return found.displayName || getAssetDisplayName(found);
    }
    return asset;
  }
  if (asset.displayName) return asset.displayName;
  const name = asset.name || '';
  const className = asset.equipment_types?.name || asset.class_name;
  if (className && name) {
    if (name.startsWith(className + ' - ')) return name;
    return `${className} - ${name}`;
  }
  return name;
}

export function priorityMeta(p) {
  if (p === 'P1') return { label: 'Critical', cls: 'prio-crit' };
  if (p === 'P2') return { label: 'High', cls: 'prio-warn' };
  if (p === 'P3' || p === 'P4') return { label: 'Normal', cls: 'prio-normal' };
  return { label: 'Unset', cls: 'prio-normal' };
}

// Global UI Utilities
export function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'err' ? ' err' : '');
  el.innerHTML = `<i data-lucide="${kind === 'err' ? 'alert-circle' : 'check-circle'}"></i> ${msg}`;
  document.getElementById('toast-container').appendChild(el);
  lucide.createIcons({ root: el });
  setTimeout(() => el.remove(), 2600);
}

export function setButtonLoading(btnId, isLoading, originalText = '') {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = isLoading;
  if (isLoading) {
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Saving...`;
  } else {
    btn.innerHTML = btn.dataset.orig || originalText;
  }
  lucide.createIcons({ root: btn });
}

export function getLoaderHtml(text = 'Loading...') {
  return `<div class="readout-empty"><i data-lucide="loader-2" class="spin" style="width:24px;height:24px;color:var(--amber);"></i> ${text}</div>`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatTime12(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatDateOnly(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatLogDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
                  d.getMonth() === now.getMonth() &&
                  d.getDate() === now.getDate();
  const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  if (isToday) return timeStr;
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${dateStr}, ${timeStr}`;
}

export function getTechnicianName(v) {
  if (!v) return 'unassigned';
  if (v.technician && v.technician.trim()) return v.technician.trim();
  if (v.logged_by && state.usersCache && state.usersCache[v.logged_by]) return state.usersCache[v.logged_by];
  if (v.logged_by && state.currentUser && v.logged_by === state.currentUser.id) {
    return state.currentUserFullName || state.currentUser.email || 'You';
  }
  return 'unassigned';
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
