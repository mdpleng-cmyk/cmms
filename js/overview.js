import { sb, state, escapeHtml, formatDate, formatTime12, formatLogDateTime, getTechnicianName } from './store.js';

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
    const secondaryText = hasAsset ? (wo.description || 'No description') : null;

    // Severity left-border class: P1/P2 → critical, 5+ days stale → warning
    const sevClass = isCrit ? 'sev-critical' : stale >= 5 ? 'sev-warning' : '';

    // Status badge (soft, no uppercase — styled via #ov-open-list .badge in CSS)
    const statusBadge = `<span class="badge ${wo.status}">${wo.status.replace('_', ' ')}</span>`;

    // Category tag — border-only mono chip
    const catTag = hasAsset && wo.assets?.category
      ? `<span class="ov-wo-tag">${escapeHtml(wo.assets.category.replace('_', ' '))}</span>`
      : '';

    // Last-action log excerpt (truncated to 120 chars) or visit-type fallback
    const logTime = lv?.visited_at ? `<span style="color:var(--ov-text-muted); font-size:11px; font-family:var(--ov-font-data);">&middot; ${formatDate(lv.visited_at)}</span>` : '';
    const logHtml = lv && lv.action_taken
      ? `<div class="ov-wo-log">${escapeHtml(lv.action_taken.slice(0, 120))}${lv.action_taken.length > 120 ? '…' : ''} &mdash; ${lv.technician ? `<b>${escapeHtml(lv.technician)}</b>` : `<span style="color:var(--ov-text-muted);">unassigned</span>`} ${logTime}</div>`
      : lv
        ? `<div class="ov-open-sub" style="margin-top:4px;"><i data-lucide="corner-down-right" style="width:11px; vertical-align:-1px;"></i> ${escapeHtml(lv.visit_type)} &middot; ${escapeHtml(lv.technician || 'unassigned')} ${logTime}</div>`
        : '';

    // Stale age indicator in side column (replaces the old stale badge)
    const staleHtml = stale
      ? `<div class="ov-wo-stale ${stale >= 5 ? 'crit' : ''}"><i data-lucide="clock" style="width:12px; height:12px;"></i>${stale}d${!lv ? ', no update' : ' stale'}</div>`
      : '';

    // Priority badge — P1/P2 only; P3 is default/normal so no badge needed
    const prioHtml = (p === 'P1' || p === 'P2')
      ? `<span class="ov-prio-badge ${p.toLowerCase()}">${p}</span>`
      : '';


    return `
      <div class="ov-open-row ${sevClass}" onclick="window.openWoDetailModal(${wo.id})">
        <div style="min-width:0; flex:1;">
          <div style="display:flex; align-items:center; gap:7px; flex-wrap:wrap;">
            <span class="ov-open-asset${wo.type === 'other' ? ' other-type' : ''}">${escapeHtml(primaryText)}</span>
            ${catTag}
            ${statusBadge}
            ${prioHtml}
          </div>
          ${secondaryText ? `<div class="ov-open-desc">${escapeHtml(secondaryText)}</div>` : ''}
          ${logHtml}
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px; flex-shrink:0;">
          <span class="ov-wo-num">WO#${wo.id}</span>
          ${staleHtml}
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
  const [openRes, schedRes, visitsRes, notesRes, usersRes] = await Promise.all([
    sb.from('work_orders').select('id, type, status, priority, description, opened_at, asset_id, planned_date, assets(name, criticality, category)').in('status', ['open','in_progress','waiting_parts']).order('opened_at', { ascending: true }),
    sb.from('recurring_schedules').select('id, title, next_due_at, active, asset_id, snoozed_until, assets(name)').eq('active', true).order('next_due_at', { ascending: true }),
    sb.from('wo_visits').select('id, visit_type, action_taken, technician, logged_by, visited_at, wo_id, work_orders(id, asset_id, description, status, assets(name))').order('visited_at', { ascending: false }).limit(20),
    sb.from('notes').select('id, text, done, created_at').order('created_at', { ascending: false }),
    sb.from('user_roles').select('user_id, full_name'),
  ]);

  if (usersRes.data) {
    usersRes.data.forEach(u => { if (u.user_id && u.full_name) state.usersCache[u.user_id] = u.full_name; });
  }

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

  // ---- PM due — hero card for overdue, list rows for upcoming ----
  let pmHtml = '';
  if (!activeItems.length) {
    pmHtml = `<div class="ov-pm-list-row" style="color:var(--ov-text-muted); font-size:12px;">Nothing due in the next ${PM_DUE_WINDOW_DAYS} days.</div>`;
  } else {
    let startIdx = 0;
    // First overdue item gets hero treatment
    if (activeItems[0].days < 0) {
      const h = activeItems[0];
      const absDays = Math.abs(h.days);
      pmHtml += `
        <div class="ov-pm-hero">
          <div class="ov-pm-hero-top">
            <div>
              <div class="ov-pm-hero-asset">${escapeHtml(h.assets?.name || 'Unknown asset')}</div>
              <div class="ov-pm-hero-cycle">${escapeHtml(h.title)}</div>
            </div>
            <div class="ov-pm-hero-overdue">${absDays}d overdue</div>
          </div>
          <div class="ov-pm-snooze">
            <button class="ov-pm-btn" onclick="window.snoozeSchedule(${h.id}, 1)">+1h</button>
            <button class="ov-pm-btn" onclick="window.snoozeSchedule(${h.id}, 4)">+4h</button>
            <button class="ov-pm-btn" onclick="window.snoozeSchedule(${h.id}, 24)">+1d</button>
          </div>
        </div>`;
      startIdx = 1;
    }
    // Remaining items as list rows (including any additional overdue ones)
    pmHtml += activeItems.slice(startIdx).map(s => {
      const label = s.days < 0 ? `${Math.abs(s.days)}d overdue` : s.days === 0 ? 'Due today' : `Due in ${s.days}d`;
      const dueCls = s.days < 0 ? 'over' : s.days === 0 ? 'soon' : '';
      return `
        <div class="ov-pm-list-row">
          <span>${escapeHtml(s.assets?.name || 'Unknown')} &mdash; ${escapeHtml(s.title)}</span>
          <span class="ov-pm-list-due ${dueCls}">${label}</span>
        </div>`;
    }).join('');
  }

  const snoozedHtml = snoozedItems.length
    ? `<div class="ov-pm-snoozed">Snoozed: ${snoozedItems.map(s => `${escapeHtml(s.title)} (until ${formatDate(s.snoozed_until)})`).join(', ')}</div>`
    : '';

  // ---- Recent activity (mobile-friendly logbook layout) ----
  const activityHtml = visits.length ? visits.map(v => {
    const assetName = v.work_orders
      ? (v.work_orders.asset_id == null ? 'General (No Asset)' : (v.work_orders.assets?.name || 'Unknown asset'))
      : 'WO #' + v.wo_id;
    const problemDesc = v.work_orders?.description || '';
    const updateText = v.action_taken || '';
    const techName = getTechnicianName(v);
    const timeStr = formatLogDateTime(v.visited_at);
    const subTime = formatTime12(v.visited_at);

    // Current status badge
    const rawStatus = v.work_orders?.status || (v.visit_type === 'closed' ? 'closed' : 'open');
    const statusCls = rawStatus === 'closed' ? 'closed' : rawStatus === 'waiting_parts' ? 'waiting_parts' : rawStatus === 'in_progress' ? 'in_progress' : 'open';
    const statusLabel = rawStatus.replace('_', ' ');

    return `
      <div class="ov-activity-row" onclick="window.openWoDetailModal(${v.wo_id})">
        <div class="ov-activity-top">
          <span class="ov-activity-time">${timeStr}</span>
          <span class="ov-wo-num">WO#${v.wo_id}</span>
        </div>
        <div class="ov-activity-asset">${escapeHtml(assetName)}</div>
        ${problemDesc ? `<div class="ov-activity-problem">${escapeHtml(problemDesc)}</div>` : ''}
        <div class="ov-activity-bottom">
          <span class="ov-activity-action">${escapeHtml(updateText || v.visit_type.replace('_',' '))}</span>
          <span class="ov-activity-sep">&mdash;</span>
          <span class="ov-activity-tech">${escapeHtml(techName)}</span>
          <span class="ov-activity-sep">&middot;</span>
          <span class="ov-activity-subtime">${subTime}</span>
          <span class="badge ${statusCls} ov-activity-status">${statusLabel}</span>
        </div>
      </div>`;
  }).join('') : `<div class="ov-pm-list-row" style="color:var(--ov-text-muted); font-size:12px;">No recent activity.</div>`;

  // ---- Notes — split into open / done groups ----
  const openNotes = notes.filter(n => !n.done);
  const doneNotes  = notes.filter(n =>  n.done);
  const noteGroup = (arr, checked) => arr.map(n => `
    <label class="ov-note-item${checked ? ' done' : ''}">
      <input type="checkbox" ${checked ? 'checked' : ''} onchange="window.toggleNoteDone(${n.id}, this.checked)">
      <span>${escapeHtml(n.text)}</span>
    </label>`).join('');
  const notesHtml = !notes.length
    ? `<div style="color:var(--ov-text-muted); font-size:12px; padding:4px 0;">No notes yet.</div>`
    : `${openNotes.length  ? `<div class="ov-note-group-label">open</div>${noteGroup(openNotes, false)}`   : ''}
       ${doneNotes.length  ? `<div class="ov-note-group-label">done</div>${noteGroup(doneNotes, true)}`    : ''}`;

  const cntOpen     = openWOs.filter(w => w.status === 'open').length;
  const cntProgress = openWOs.filter(w => w.status === 'in_progress').length;
  const cntWaiting  = openWOs.filter(w => w.status === 'waiting_parts').length;

  el.innerHTML = `
    <div class="ov-row-2-wide">
      <div class="ov-panel">
        <div class="ov-panel-head">
          <div class="ov-panel-title-row"><div class="ov-icon-badge blue"><i data-lucide="clipboard-list"></i></div><div class="ov-panel-title">Open Work Orders</div></div>
          <div class="ov-subtabs">
            <button class="ov-subtab active" data-filter="all" onclick="window.filterOpenWos('all')">All (${openWOs.length})</button>
            <button class="ov-subtab" data-filter="open" onclick="window.filterOpenWos('open')">Open (${cntOpen})</button>
            <button class="ov-subtab" data-filter="in_progress" onclick="window.filterOpenWos('in_progress')">In Progress (${cntProgress})</button>
            <button class="ov-subtab" data-filter="waiting_parts" onclick="window.filterOpenWos('waiting_parts')">Awaiting Spares (${cntWaiting})</button>
          </div>
        </div>
        <div id="ov-open-list">${openHtml}</div>
      </div>
      <div class="ov-panel">
        <div class="ov-panel-head"><div class="ov-panel-title-row"><div class="ov-icon-badge amber"><i data-lucide="calendar-clock"></i></div><div class="ov-panel-title">PM Due</div></div></div>
        <div style="padding-top:10px; padding-bottom:6px;">${pmHtml}${snoozedHtml}</div>
      </div>
    </div>

    <div class="ov-row-2-wide">
      <div class="ov-panel">
        <div class="ov-panel-head">
          <div class="ov-panel-title-row"><div class="ov-icon-badge green"><i data-lucide="activity"></i></div><div class="ov-panel-title">Recent Activity</div></div>
          <span style="font-size:11px; color:var(--ov-text-muted); font-family:var(--ov-font-data);">Last ${visits.length} updates</span>
        </div>
        <div class="ov-activity-scroll">${activityHtml}</div>
      </div>
      <div class="ov-panel">
        <div class="ov-panel-head"><div class="ov-panel-title-row"><div class="ov-icon-badge purple"><i data-lucide="bell"></i></div><div class="ov-panel-title">Reminders</div></div></div>
        <div class="ov-panel-body">
          <div style="display:flex; gap:6px; margin-bottom:10px;">
            <input id="new-note-text" class="ov-note-input" placeholder="Add a note…" style="flex:1;" onkeydown="if(event.key==='Enter') window.addNote()">
            <button class="ov-pm-btn" onclick="window.addNote()">+</button>
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
