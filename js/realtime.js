import { sb, state } from './store.js';
import { loadWorkOrders, refreshOpenWoDetail } from './workOrders.js';
import { loadSchedules } from './schedules.js';
import { loadOverview } from './overview.js';

let realtimeChannel = null;
let refreshTimer = null;
const pendingRefreshes = new Set();

function scheduleRefresh(kind) {
  pendingRefreshes.add(kind);
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    const refreshes = new Set(pendingRefreshes);
    pendingRefreshes.clear();
    refreshTimer = null;

    const tasks = [];
    if (refreshes.has('workOrders')) tasks.push(loadWorkOrders());
    if (refreshes.has('schedules')) tasks.push(loadSchedules());
    if (refreshes.has('overview')) tasks.push(loadOverview());
    if (refreshes.has('detail')) tasks.push(refreshOpenWoDetail());
    await Promise.all(tasks);
  }, 150);
}

function payloadWoId(payload) {
  return payload.new?.wo_id ?? payload.old?.wo_id;
}

function handleChange(table, payload) {
  if (table === 'work_orders') {
    scheduleRefresh('workOrders');
    scheduleRefresh('overview');
    if (payload.new?.id === state.woDetailCurrent?.id || payload.old?.id === state.woDetailCurrent?.id) {
      scheduleRefresh('detail');
    }
    if (payload.new?.type === 'pm' || payload.old?.type === 'pm') scheduleRefresh('schedules');
    return;
  }

  if (table === 'wo_visits') {
    scheduleRefresh('overview');
    if (payloadWoId(payload) === state.woDetailCurrent?.id) scheduleRefresh('detail');
    return;
  }

  if (table === 'wo_checklist_results') {
    if (payloadWoId(payload) === state.woDetailCurrent?.id) scheduleRefresh('detail');
    return;
  }

  if (table === 'recurring_schedules') {
    scheduleRefresh('schedules');
    scheduleRefresh('overview');
  }
}

export function startRealtime() {
  if (realtimeChannel) return;

  realtimeChannel = sb
    .channel('cmms-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, payload => handleChange('work_orders', payload))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wo_visits' }, payload => handleChange('wo_visits', payload))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wo_checklist_results' }, payload => handleChange('wo_checklist_results', payload))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_schedules' }, payload => handleChange('recurring_schedules', payload))
    .subscribe();
}

export async function stopRealtime() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  pendingRefreshes.clear();
  if (!realtimeChannel) return;
  const channel = realtimeChannel;
  realtimeChannel = null;
  await sb.removeChannel(channel);
}