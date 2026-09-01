import { sb, state, setButtonLoading, toast } from './store.js';
import { loadAssets } from './assets.js';
import { loadWorkOrders } from './workOrders.js';

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
  document.getElementById('app').classList.remove('hidden');

  const canWrite = state.currentRole === 'admin' || state.currentRole === 'technician';
  document.getElementById('btn-new-wo').style.display = canWrite ? '' : 'none';
  document.getElementById('btn-new-schedule').style.display = canWrite ? '' : 'none';
  document.getElementById('btn-new-asset').style.display = state.currentRole === 'admin' ? '' : 'none';

  lucide.createIcons();
  await loadAssets();
  await loadWorkOrders();
}
