import { sb, state, escapeHtml, formatDate } from './store.js';

const PM_DUE_WINDOW_DAYS = 7;
const STALE_DAYS = 2;

function staleDaysFor(wo, latestVisit, todayStart) {
  if (wo.status === 'waiting_parts') return 0;
  let effectiveStart = latestVisit ? new Date(latestVisit.visited_at) : new Date(wo.opened_at);
  if (wo.planned_date) {
    const planned = new Date(wo.planned_date + 'T00:00:00');
    if (planned > todayStart) return 0;
    if (planned > effectiveStart) effectiveStart = planned;
  }
  const days = Math.floor((todayStart - effectiveStart) / 86400000);
  return days >= STALE_DAYS ? days : 0;
}
let cachedOpenWOs = [];
let cachedLatestVisitByWo = {};
let openWoFilter = 'all';

function priorityRank(p) {
  return { P1: 1, P2: 2, P3: 3, P4: 4 }[p] || 5;
}

function hasFuturePlannedDate(wo, todayStart) {
  return !!wo.planned_date && new Date(wo.planned_date + 'T00:00:00') > todayStart;
}

function renderOpenWoList() {
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  let filtered = cachedOpenWOs.filter(w => !hasFuturePlannedDate(w, todayStart));
  if (openWoFilter !== 'all') filtered = filtered.filter(w => w.status === openWoFilter);
  filtered = [...filtered].sort((a, b) => {
    const pa = priorityRank(a.priority || a.assets?.criticality);
    const pb = priorityRank(b.priority || b.assets?.criticality);
    if (pa !== pb) return pa - pb;
    const oa = a.type === 'other' ? 1 : 0;
    const ob = b.type === 'other' ? 1 : 0;
    if (oa !== ob) return oa - ob;
    const sa = staleDaysFor(a, cachedLatestVisitByWo[a.id], todayStart);
    const sb = staleDaysFor(b, cachedLatestVisitByWo[b.id], todayStart);
    if (sb !== sa) return sb - sa;
    return new Date(a.opened_at) - new Date(b.opened_at);
  });
  return filtered.length ? filtered.map(wo => {
    const p = wo.priority || wo.assets?.criticality;
    const isCrit = p === 'P1' || p === 'P2';
    const lv = cachedLatestVisitByWo[wo.id];
    const stale = staleDaysFor(wo, lv, todayStart);
    const hasAsset = wo.asset_id != null;
    const primaryText = hasAsset ? (wo.assets?.name || 'Unknown asset') : (wo.description || 'No asset');
    const secondaryText = hasAsset ? (wo.description || 'No description') : 'No asset';
    return `
      <div class="ov-open-row ${isCrit ? 'crit' : ''}" onclick="window.openWoDetailModal(${wo.id})">
        <div style="min-width:0;">
          <div class="ov-open-asset ${wo.type === 'other' ? 'other-type' : ''}">${escapeHtml(primaryText)} ${hasAsset && wo.assets?.category ? `<span class="badge" style="font-size:9px; vertical-align:2px;">${escapeHtml(wo.assets.category.replace('_',' '))}</span>` : ''}</div>
          <div class="ov-open-desc">${escapeHtml(secondaryText)}</div>
          <div class="ov-open-sub">${lv ? `<i data-lucide="corner-down-right" style="width:11px; vertical-align:-1px;"></i> ${escapeHtml(lv.action_taken || lv.visit_type)} &middot; ${escapeHtml(lv.technician || 'unassigned')}` : 'No updates yet'}</div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px; flex-shrink:0;">
          ${stale ? `<span class="badge" style="font-size:9px; background:rgba(239,68,68,.12); color:var(--red);">No update ${stale}d</span>` : ''}
          <span class="badge ${wo.status}" style="font-size:9px;">${wo.status.replace('_',' ')}</span>
        </div>
      </div>`;
  }).join('') : '<div class="card-meta" style="padding:14px;">Nothing here.</div>';
}

export function filterOpenWos(status) {
  openWoFilter = status;
  document.querySelectorAll('.ov-subtab').forEach(b => b.classList.toggle('active', b.dataset.filter === status));
  document.getElementById('ov-open-list').innerHTML = renderOpenWoList();
  lucide.createIcons({ root: document.getElementById('ov-open-list') });
}

window.filterOpenWos = filterOpenWos;

export async function loadOverview() {
  const el = document.getElementById('tab-overview');
  el.innerHTML = `<div class="readout-empty" style="padding-top:60px;">Loading overview...</div>`;

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const [openRes, schedRes, visitsRes, notesRes] = await Promise.all([
    sb.from('work_orders').select('id, type, status, priority, description, opened_at, asset_id, planned_date, assets(name, criticality, category)').in('status', ['open','in_progress','waiting_parts']).order('opened_at', { ascending: true }),
    sb.from('recurring_schedules').select('id, title, next_due_at, active, asset_id, snoozed_until, assets(name)').eq('active', true).order('next_due_at', { ascending: true }),
    sb.from('wo_visits').select('visit_type, action_taken, technician, visited_at, wo_id, work_orders(id, asset_id, description, assets(name))').order('visited_at', { ascending: false }).limit(20),
    sb.from('notes').select('id, text, done, created_at').order('created_at', { ascending: false }),
  ]);

  const openWOs = openRes.data || [];
  const schedules = schedRes.data || [];
  const visits = visitsRes.data || [];
  const notes = notesRes.data || [];

  // ---- latest visit per open WO, for the collapsed "issue + action + who" row ----
  cachedOpenWOs = openWOs;
  cachedLatestVisitByWo = {};
  visits.forEach(v => { if (!cachedLatestVisitByWo[v.wo_id]) cachedLatestVisitByWo[v.wo_id] = v; });
  const openHtml = renderOpenWoList();

  // ---- PM due within window, split active/snoozed ----
  const now = new Date();
  const dueItems = schedules
    .map(s => ({ ...s, days: Math.round((new Date(s.next_due_at) - todayStart) / 86400000) }))
    .filter(s => s.days <= PM_DUE_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days);
  const activeItems = dueItems.filter(s => !s.snoozed_until || new Date(s.snoozed_until) <= now);
  const snoozedItems = dueItems.filter(s => s.snoozed_until && new Date(s.snoozed_until) > now);

  const pmHtml = activeItems.length ? activeItems.map(s => {
    const label = s.days < 0 ? `${Math.abs(s.days)}d overdue` : s.days === 0 ? 'Due today' : `Due in ${s.days}d`;
    const cls = s.days < 0 ? 'over' : s.days === 0 ? 'soon' : '';
    return `
      <div style="padding:8px 0; border-bottom:1px solid var(--border);">
        <div style="font-size:13px; color:var(--text);">${escapeHtml(s.title)} &mdash; ${escapeHtml(s.assets?.name || '')}</div>
        <div class="ov-pm-due-days ${cls}" style="padding:0;">${label}</div>
        ${s.days <= 0 ? `
          <div class="ov-snooze-row">
            <span class="ov-snooze-btn" onclick="window.snoozeSchedule(${s.id}, 1)">Snooze 1h</span>
            <span class="ov-snooze-btn" onclick="window.snoozeSchedule(${s.id}, 4)">4h</span>
            <span class="ov-snooze-btn" onclick="window.snoozeSchedule(${s.id}, 24)">1d</span>
          </div>` : ''}
      </div>`;
  }).join('') : '<div class="card-meta">Nothing due in the next ' + PM_DUE_WINDOW_DAYS + ' days.</div>';

  const snoozedHtml = snoozedItems.length ? `
    <div class="ov-snoozed-list">
      Snoozed: ${snoozedItems.map(s => `${escapeHtml(s.title)} (until ${formatDate(s.snoozed_until)})`).join(', ')}
    </div>` : '';

  // ---- Recent activity, collapsed asset + issue + outcome + who ----
  const activityHtml = visits.length ? visits.slice(0, 6).map(v => `
    <div class="ov-activity-row" onclick="window.openWoDetailModal(${v.wo_id})">
      <b>${escapeHtml(v.work_orders ? (v.work_orders.asset_id == null ? 'No asset' : (v.work_orders.assets?.name || 'Unknown asset')) : 'WO #' + v.wo_id)}</b> &mdash; ${escapeHtml(v.work_orders?.description || v.visit_type)}
      <span class="badge ${v.visit_type === 'closed' ? 'closed' : 'open'}" style="font-size:9px; margin-left:4px;">${v.visit_type.replace('_',' ')}</span>
      <div style="color:var(--text-muted); font-size:11px; margin-top:2px;">${escapeHtml(v.technician || 'unassigned')}</div>
    </div>
  `).join('') : '<div class="card-meta">No recent activity.</div>';

  // ---- Notes ----
  const notesHtml = notes.length ? notes.map(n => `
    <div class="ov-note-row ${n.done ? 'done' : ''}">
      <input type="checkbox" ${n.done ? 'checked' : ''} onchange="window.toggleNoteDone(${n.id}, this.checked)" style="margin-top:2px;">
      <span>${escapeHtml(n.text)}</span>
    </div>
  `).join('') : '<div class="card-meta">No notes yet.</div>';

  el.innerHTML = `

    <div class="ov-row-2-wide">
      <div class="ov-panel">
        <div class="ov-panel-head">
          <div class="ov-panel-title-row"><div class="ov-icon-badge blue"><i data-lucide="clipboard-list"></i></div><div class="ov-panel-title">Open Work Orders</div></div>
          <div class="ov-subtabs">
            <button class="ov-subtab active" data-filter="all" onclick="window.filterOpenWos('all')">All (${openWOs.length})</button>
            <button class="ov-subtab" data-filter="open" onclick="window.filterOpenWos('open')">Open</button>
            <button class="ov-subtab" data-filter="in_progress" onclick="window.filterOpenWos('in_progress')">In Progress</button>
            <button class="ov-subtab" data-filter="waiting_parts" onclick="window.filterOpenWos('waiting_parts')">Awaiting Spares</button>
          </div>
        </div>
        <div id="ov-open-list">${openHtml}</div>
      </div>
      <div class="ov-panel">
        <div class="ov-panel-head"><div class="ov-panel-title-row"><div class="ov-icon-badge amber"><i data-lucide="calendar-clock"></i></div><div class="ov-panel-title">PM Due</div></div></div>
        <div class="ov-panel-body">${pmHtml}${snoozedHtml}</div>
      </div>
    </div>

    <div class="ov-row-2-wide">
      <div class="ov-panel">
        <div class="ov-panel-head"><div class="ov-panel-title-row"><div class="ov-icon-badge green"><i data-lucide="activity"></i></div><div class="ov-panel-title">Recent Activity</div></div></div>
        <div class="ov-panel-body">${activityHtml}</div>
      </div>
      <div class="ov-panel">
        <div class="ov-panel-head">
          <div class="ov-panel-title-row"><div class="ov-icon-badge purple"><i data-lucide="bell"></i></div><div class="ov-panel-title">Reminders</div></div>
        </div>
        <div class="ov-panel-body">
          <div class="row" style="margin-bottom:8px; gap:6px;">
            <input id="new-note-text" placeholder="Add a note..." style="flex:1; font-size:12px; padding:6px 8px;">
            <button class="ghost" style="padding:6px 10px; font-size:11px; border:1px solid var(--border);" onclick="window.addNote()">+</button>
          </div>
          ${notesHtml}
        </div>
      </div>
    </div>
  `;

  lucide.createIcons({ root: el });
}

export async function snoozeSchedule(scheduleId, hours) {
  const until = new Date(Date.now() + hours * 3600000).toISOString();
  await sb.from('recurring_schedules').update({ snoozed_until: until }).eq('id', scheduleId);
  loadOverview();
}

export async function addNote() {
  const input = document.getElementById('new-note-text');
  const text = input.value.trim();
  if (!text) return;
  await sb.from('notes').insert({ text, created_by: state.currentUser.id });
  loadOverview();
}

export async function toggleNoteDone(id, done) {
  await sb.from('notes').update({ done }).eq('id', id);
  loadOverview();
}

window.snoozeSchedule = snoozeSchedule;
window.addNote = addNote;
window.toggleNoteDone = toggleNoteDone;
