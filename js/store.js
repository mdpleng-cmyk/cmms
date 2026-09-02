const SUPABASE_URL = "https://eizyetgfrqlrlhvrxjsq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpenlldGdmcnFscmxodnJ4anNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMzMwMDUsImV4cCI6MjEwMzgwOTAwNX0.xYjQ5IF2SKYpiXQtxSvSLmT7dPwaHv8w9Z1kpNGdH_g";

export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  assetsCache: [],
  schedulesCache: [],
  activeWorkOrders: [],
  woToUpdate: null
};

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
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
