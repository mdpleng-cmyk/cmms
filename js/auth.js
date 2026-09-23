import { sb, state, isRecoveryLink, setButtonLoading, toast } from './store.js';
import { loadAssets } from './assets.js';
import { loadWorkOrders } from './workOrders.js';
import { loadOverview } from './overview.js';
import { startRealtime, stopRealtime } from './realtime.js';

// Set to true when the user arrives via a password-recovery email link.
let inPasswordRecovery = isRecoveryLink;
export function isInPasswordRecovery() { return inPasswordRecovery; }

function showSetPasswordScreen() {
  inPasswordRecovery = true;
  document.getElementById('login-screen').classList.add('hidden');
  const appEl = document.getElementById('app');
  if (appEl) appEl.classList.add('hidden');
  const setPwdEl = document.getElementById('set-password-screen');
  if (setPwdEl) setPwdEl.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

// If this page load was triggered by a recovery link, show set-password screen immediately
if (isRecoveryLink) {
  showSetPasswordScreen();
}

// Intercept Supabase PASSWORD_RECOVERY event
sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    showSetPasswordScreen();
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
  if (inPasswordRecovery) {
    // If a recovery link was used, do not show the dashboard until the password is set.
    return;
  }
  state.currentUser = user;
  const { data: roleRow, error } = await sb.from('user_roles').select('role, full_name').eq('user_id', user.id).single();
  if (error || !roleRow) { toast('No role assigned yet.', 'err'); return; }
  
  state.currentRole = roleRow.role;
  state.currentUserFullName = roleRow.full_name || '';
  if (roleRow.full_name) state.usersCache[user.id] = roleRow.full_name;

  // Pre-load all user names for activity and visit logs
  sb.from('user_roles').select('user_id, full_name').then(({ data }) => {
    if (data) data.forEach(u => { if (u.user_id && u.full_name) state.usersCache[u.user_id] = u.full_name; });
  }).catch(() => {});

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
  try {
    window.history.replaceState(null, '', window.location.pathname);
  } catch (e) {}

  document.getElementById('set-password-screen').classList.add('hidden');
  toast('Password set successfully!');
  await onSignedIn(data.user);
}

// ── In-app Change Password (for already logged-in users) ───────────────────

export function openChangePasswordModal() {
  document.getElementById('change-pwd-new').value = '';
  document.getElementById('change-pwd-confirm').value = '';
  document.getElementById('change-pwd-error').textContent = '';
  document.getElementById('modal-change-password').classList.remove('hidden');
  lucide.createIcons({ root: document.getElementById('modal-change-password') });
  document.getElementById('change-pwd-new').focus();
}

export function closeChangePasswordModal() {
  document.getElementById('modal-change-password').classList.add('hidden');
}

export async function saveChangedPassword() {
  const newPwd = document.getElementById('change-pwd-new').value;
  const confirmPwd = document.getElementById('change-pwd-confirm').value;
  const errEl = document.getElementById('change-pwd-error');
  errEl.textContent = '';

  if (!newPwd || newPwd.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.';
    return;
  }
  if (newPwd !== confirmPwd) {
    errEl.textContent = 'Passwords do not match.';
    return;
  }

  setButtonLoading('btn-save-changed-pwd', true);
  const { error } = await sb.auth.updateUser({ password: newPwd });
  setButtonLoading('btn-save-changed-pwd', false, '<i data-lucide="save"></i> Update Password');

  if (error) {
    errEl.textContent = error.message;
    return;
  }

  closeChangePasswordModal();
  toast('Password updated successfully!');
}
