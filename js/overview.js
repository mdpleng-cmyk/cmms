import { sb, sbTelemetry, state, escapeHtml, formatDate, priorityMeta } from './store.js';

const PM_DUE_WINDOW_DAYS = 7;

function priorityRank(p) {
  return { P1: 1, P2: 2, P3: 3, P4: 4 }[p] || 5;
}

export async function loadOverview() {
  const el = document.getElementById('tab-overview');
  el.innerHTML = `<div class="readout-empty" style="padding-top:60px;">Loading overview...</div>`;

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  const [openRes, schedRes, visitsRes, notesRes, readingsRes, metersRes] = await Promise.all([
    sb.from('work_orders').select('id, type, status, priority, description, opened_at, asset_id, assets(name, criticality)').in('status', ['open','in_progress','waiting_parts']).order('opened_at', { ascending: true }),
    sb.from('recurring_schedules').select('id, title, next_due_at, active, asset_id, snoozed_until, assets(name)').eq('active', true).order('next_due_at', { ascending: true }),
    sb.from('wo_visits').select('visit_type, action_taken, technician, visited_at, wo_id, work_orders(id, asset_id, description, assets(name))').order('visited_at', { ascending: false }).limit(20),
    sb.from('notes').select('id, text, done, created_at').order('created_at', { ascending: false }),
    sbTelemetry.from('meter_readings').select('meter_id, reading_value, consumption, recorded_at').gte('recorded_at', thirtyDaysAgo.toISOString()).order('recorded_at', { ascending: false }).limit(2000).then(r => r).catch(() => ({ data: null, error: true })),
    sbTelemetry.from('meters').select('id, name, unit, meter_type, active').eq('active', true).then(r => r).catch(() => ({ data: null, error: true })),
  ]);

  const openWOs = openRes.data || [];
  const schedules = schedRes.data || [];
  const visits = visitsRes.data || [];
  const notes = notesRes.data || [];

  // ---- latest visit per open WO, for the collapsed "issue + action + who" row ----
  const latestVisitByWo = {};
  visits.forEach(v => { if (!latestVisitByWo[v.wo_id]) latestVisitByWo[v.wo_id] = v; });

  const openHtml = openWOs.length ? openWOs.map(wo => {
    const p = wo.priority || wo.assets?.criticality;
    const isCrit = p === 'P1' || p === 'P2';
    const lv = latestVisitByWo[wo.id];
    return `
      <div class="ov-open-row ${isCrit ? 'crit' : ''}" onclick="window.openWoDetailModal(${wo.id})">
        <div style="min-width:0;">
          <div class="ov-open-asset">${escapeHtml(wo.assets?.name || 'Unknown')}</div>
          <div class="ov-open-desc">${escapeHtml(wo.description || 'No description')}</div>
          <div class="ov-open-sub">${lv ? `<i data-lucide="corner-down-right" style="width:11px; vertical-align:-1px;"></i> ${escapeHtml(lv.action_taken || lv.visit_type)} &middot; ${escapeHtml(lv.technician || 'unassigned')}` : 'No updates yet'}</div>
        </div>
        <span class="badge ${wo.status}" style="font-size:9px; flex-shrink:0;">${wo.status.replace('_',' ')}</span>
      </div>`;
  }).join('') : '<div class="card-meta" style="padding:14px;">No open work orders.</div>';

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
      <b>${escapeHtml(v.work_orders?.assets?.name || 'WO #' + v.wo_id)}</b> &mdash; ${escapeHtml(v.work_orders?.description || v.visit_type)}
      <span class="badge ${v.visit_type === 'closed' ? 'closed' : 'open'}" style="font-size:9px; margin-left:4px;">${v.visit_type.replace('_',' ')}</span>
      <div style="color:var(--text-muted); font-size:11px; margin-top:2px;">${escapeHtml(v.technician || 'unassigned')}</div>
    </div>
  `).join('') : '<div class="card-meta">No recent activity.</div>';

  // ---- Meters: latest reading + 30-day average per meter ----
  const meterById = {};
  (metersRes.data || []).forEach(m => { meterById[m.id] = m; });
  const readings = readingsRes.data || [];
  const latestByMeter = {};
  const sumByMeter = {};
  const countByMeter = {};
  readings.forEach(r => {
    if (!latestByMeter[r.meter_id]) latestByMeter[r.meter_id] = r;
    if (r.consumption != null) {
      sumByMeter[r.meter_id] = (sumByMeter[r.meter_id] || 0) + r.consumption;
      countByMeter[r.meter_id] = (countByMeter[r.meter_id] || 0) + 1;
    }
  });
  const meterFetchFailed = readingsRes.error || metersRes.error;
  const meterIds = Object.keys(latestByMeter).filter(id => meterById[id]).slice(0, 6);

  const meterHtml = meterFetchFailed
    ? '<div class="card-meta">Could not reach the telemetry project.</div>'
    : meterIds.length ? meterIds.map(id => {
        const meter = meterById[id];
        const latest = latestByMeter[id];
        const avg = countByMeter[id] ? sumByMeter[id] / countByMeter[id] : null;
        const val = latest.consumption;
        let deltaHtml = '';
        if (avg && val != null) {
          const pct = Math.round(((val - avg) / avg) * 100);
          deltaHtml = `<span class="ov-meter-delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '+' : ''}${pct}%</span>`;
        }
        return `
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:7px 0; border-bottom:1px solid var(--border);">
          <span class="ov-meter-name">${escapeHtml(meter.name)}</span>
          <span style="text-align:right;">
            <div style="font-family:'JetBrains Mono',monospace; font-size:13px;">${val != null ? val.toLocaleString() : '\u2014'} ${deltaHtml}</div>
            ${avg ? `<div class="ov-meter-avg">avg ${avg.toFixed(1)} (30d)</div>` : ''}
          </span>
        </div>`;
      }).join('') : '<div class="card-meta">No readings in the last 30 days.</div>';

  // ---- Notes ----
  const notesHtml = notes.length ? notes.map(n => `
    <div class="ov-note-row ${n.done ? 'done' : ''}">
      <input type="checkbox" ${n.done ? 'checked' : ''} onchange="window.toggleNoteDone(${n.id}, this.checked)" style="margin-top:2px;">
      <span>${escapeHtml(n.text)}</span>
    </div>
  `).join('') : '<div class="card-meta">No notes yet.</div>';

  el.innerHTML = `
    <div style="margin-bottom:14px;">
      <span style="font-family:'Oswald',sans-serif; font-size:16px; font-weight:600;">Today</span>
      <span style="font-size:12px; color:var(--text-muted); margin-left:8px;">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
    </div>

    <div class="ov-panel ov-section">
      <div class="ov-panel-head"><div class="ov-panel-title">Open Work Orders</div><div class="ov-panel-meta">${openWOs.length} open</div></div>
      <div>${openHtml}</div>
    </div>

    <div class="ov-row-3 ov-section">
      <div class="ov-panel">
        <div class="ov-panel-head"><div class="ov-panel-title">PM Due</div></div>
        <div class="ov-panel-body">${pmHtml}${snoozedHtml}</div>
      </div>
      <div class="ov-panel">
        <div class="ov-panel-head"><div class="ov-panel-title">Recent Activity</div></div>
        <div class="ov-panel-body">${activityHtml}</div>
      </div>
      <div class="ov-panel">
        <div class="ov-panel-head"><div class="ov-panel-title">Meter Readings</div><div class="ov-panel-meta">telemetry</div></div>
        <div class="ov-panel-body">${meterHtml}</div>
      </div>
    </div>

    <div class="ov-panel">
      <div class="ov-panel-head">
        <div class="ov-panel-title">Reminders</div>
        <div class="row" style="margin:0; gap:6px;">
          <input id="new-note-text" placeholder="Add a note..." style="width:200px; font-size:12px; padding:6px 8px;">
          <button class="ghost" style="padding:6px 10px; font-size:11px; border:1px solid var(--border);" onclick="window.addNote()">+ Add</button>
        </div>
      </div>
      <div class="ov-panel-body">${notesHtml}</div>
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