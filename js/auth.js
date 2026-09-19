import { sb, state, urlHashType, setButtonLoading, toast } from './store.js';
import { loadAssets } from './assets.js';
import { loadWorkOrders } from './workOrders.js';
import { loadOverview } from './overview.js';
import { startRealtime, stopRealtime } from './realtime.js';

// Set to true when the user arrives via a password-recovery email link.
let inPasswordRecovery = false;
export function isInPasswordRecovery() { return inPasswordRecovery; }

// If this page load was triggered by a recovery link, show the set-password
// screen immediately — before any session restore or auth events fire.
if (urlHashType === 'recovery') {
  inPasswordRecovery = true;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('set-password-screen').classList.remove('hidden');
}

// Backup: also intercept via onAuthStateChange in case the hash check misses.
sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    inPasswordRecovery = true;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('set-password-screen').classList.remove('hidden');
  }
});

export async function signIn() {
  setButtonLoading('btn-login', true);
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { 
    errEl.textContent = error.message; 
    setButtonLoading('btn-login', false, '<i data-lucide="log-in"></i> Sign In');
    return; 
  }
  await onSignedIn(data.user);
  setButtonLoading('btn-login', false, '<i data-lucide="log-in"></i> Sign In');
}

export async function signOut() {
  await stopRealtime();
  await sb.auth.signOut();
  state.currentUser = null; 
  state.currentRole = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

export async function onSignedIn(user) {
  state.currentUser = user;
  const { data: roleRow, error } = await sb.from('user_roles').select('role, full_name').eq('user_id', user.id).single();
  if (error || !roleRow) { toast('No role assigned yet.', 'err'); return; }
  
  state.currentRole = roleRow.role;
  document.getElementById('who-name').innerHTML = `${roleRow.full_name || user.email} &middot; ${state.currentRole}`;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('set-password-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  const canWrite = state.currentRole === 'admin' || state.currentRole === 'technician';
  document.getElementById('btn-new-wo').style.display = canWrite ? '' : 'none';
  document.getElementById('btn-new-schedule').style.display = canWrite ? '' : 'none';
  document.getElementById('btn-new-asset').style.display = state.currentRole === 'admin' ? '' : 'none';

  lucide.createIcons();
  await loadOverview();
  await loadAssets();
  await loadWorkOrders();
  startRealtime();
}

// ── Forgot password ────────────────────────────────────────────────────────

export function toggleForgotForm() {
  const form = document.getElementById('forgot-form');
  const isHidden = form.classList.toggle('hidden');
  if (!isHidden) {
    // Pre-fill with whatever the user typed in the login email field
    const loginEmail = document.getElementById('login-email').value.trim();
    if (loginEmail) document.getElementById('reset-email').value = loginEmail;
    document.getElementById('reset-email').focus();
  }
}

export async function sendResetEmail() {
  const email = document.getElementById('reset-email').value.trim();
  const statusEl = document.getElementById('reset-status');
  statusEl.textContent = '';
  statusEl.style.color = 'var(--red)';

  if (!email) { statusEl.textContent = 'Enter your email address.'; return; }

  setButtonLoading('btn-send-reset', true);
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  setButtonLoading('btn-send-reset', false, '<i data-lucide="mail"></i> Send Reset Link');

  if (error) {
    statusEl.textContent = error.message;
  } else {
    statusEl.style.color = 'var(--green)';
    statusEl.textContent = 'Reset link sent — check your email.';
  }
}

// ── Set new password (recovery landing) ───────────────────────────────────

export async function setNewPassword() {
  const password = document.getElementById('new-password').value;
  const confirm  = document.getElementById('confirm-password').value;
  const errEl    = document.getElementById('set-password-error');
  errEl.textContent = '';

  if (!password || password.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.';
    return;
  }
  if (password !== confirm) {
    errEl.textContent = 'Passwords do not match.';
    return;
  }

  setButtonLoading('btn-set-password', true);
  const { data, error } = await sb.auth.updateUser({ password });
  setButtonLoading('btn-set-password', false, '<i data-lucide="key"></i> Set Password');

  if (error) {
    errEl.textContent = error.message;
    return;
  }

  inPasswordRecovery = false;
  toast('Password set successfully!');
  await onSignedIn(data.user);
}
