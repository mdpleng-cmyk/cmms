import { sb, sbTelemetry, state, escapeHtml, formatDate } from './store.js';

export async function loadOverview() {
  const el = document.getElementById('tab-overview');
  el.innerHTML = `<div class="readout-empty" style="padding-top:60px;">Loading overview...</div>`;

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);

  const [openRes, schedRes, visitsRes, readingsRes, metersRes] = await Promise.all([
    sb.from('work_orders').select('id, type, status, opened_at, asset_id, assets(name, criticality)').in('status', ['open','in_progress','waiting_parts']).order('opened_at', { ascending: true }),
    sb.from('recurring_schedules').select('id, title, next_due_at, active, asset_id, assets(name)').eq('active', true).order('next_due_at', { ascending: true }),
    sb.from('wo_visits').select('visit_type, action_taken, technician, visited_at, wo_id, work_orders(id, asset_id, assets(name))').order('visited_at', { ascending: false }).limit(8),
    sbTelemetry.from('meter_readings').select('meter_id, reading_value, consumption, recorded_at, shift').order('recorded_at', { ascending: false }).limit(200).then(r => r).catch(() => ({ data: null, error: true })),
    sbTelemetry.from('meters').select('id, name, unit, active').eq('active', true).then(r => r).catch(() => ({ data: null, error: true })),
  ]);

  const openWOs = openRes.data || [];
  const schedules = schedRes.data || [];
  const visits = visitsRes.data || [];

  // ---- WO queue ----
  const priorityFor = c => c === 'P1' ? ['Critical','prio-crit'] : c === 'P2' ? ['High','prio-warn'] : ['Normal','prio-normal'];
  const woRows = openWOs.slice(0, 10).map(w => {
    const [label, cls] = priorityFor(w.assets?.criticality);
    const ageMs = Date.now() - new Date(w.opened_at).getTime();
    const ageH = Math.floor(ageMs / 3600000);
    const ageStr = ageH >= 24 ? `${Math.floor(ageH/24)}d ${ageH%24}h` : `${ageH}h`;
    return `
      <tr style="cursor:pointer;" onclick="window.openWoDetailModal(${w.id})">
        <td class="ov-wo-id">#${w.id}</td>
        <td>${escapeHtml(w.assets?.name || 'Unknown')}</td>
        <td>${w.type}</td>
        <td><span class="badge ${cls}" style="font-size:10px;">${label}</span></td>
        <td><span class="badge ${w.status}" style="font-size:10px;">${w.status.replace('_',' ')}</span></td>
        <td class="ov-wo-id">${ageStr}</td>
      </tr>`;
  }).join('');

  // ---- PM due soon ----
  const pmDueHtml = schedules.slice(0, 6).map(s => {
    const days = Math.round((new Date(s.next_due_at) - todayStart) / 86400000);
    const cls = days < 0 ? 'over' : days <= 3 ? 'soon' : '';
    const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d`;
    const assetName = (s.assets?.name || '').replace(/'/g, "\\'");
    return `
      <div class="ov-pm-due-item" style="cursor:pointer;" onclick="window.openAssetHistoryModal(${s.asset_id}, '${assetName}')">
        <span>${escapeHtml(s.assets?.name || '')} &mdash; ${escapeHtml(s.title)}</span>
        <span class="ov-pm-due-days ${cls}">${label}</span>
      </div>`;
  }).join('') || '<div class="card-meta">No active PM schedules.</div>';

  // ---- Meter readings (telemetry project, read-only) ----
  const meterById = {};
  (metersRes.data || []).forEach(m => { meterById[m.id] = m; });
  const seenMeters = new Set();
  const meterRows = (readingsRes.data || [])
    .filter(r => {
      if (seenMeters.has(r.meter_id)) return false;
      seenMeters.add(r.meter_id);
      return true;
    })
    .map(r => ({ ...r, meter: meterById[r.meter_id] }))
    .filter(r => r.meter)
    .slice(0, 6);
  const meterFetchFailed = readingsRes.error || metersRes.error;
  const metersBlocked = !meterFetchFailed && (metersRes.data || []).length === 0 && (readingsRes.data || []).length > 0;
  const readingsBlocked = !meterFetchFailed && (readingsRes.data || []).length === 0 && (metersRes.data || []).length > 0;

  // ---- Activity feed ----
  const activityHtml = visits.length ? visits.map(v => `
    <div class="ov-activity-item" style="cursor:pointer;" onclick="window.openWoDetailModal(${v.wo_id})">
      <span class="ov-activity-time">${formatDate(v.visited_at).split(',')[1] || formatDate(v.visited_at)}</span>
      <span class="ov-activity-text"><b>${escapeHtml(v.technician || 'Someone')}</b> ${v.visit_type} &middot; ${escapeHtml(v.work_orders?.assets?.name || 'WO #' + v.wo_id)}</span>
    </div>
  `).join('') : '<div class="card-meta">No recent activity.</div>';

  el.innerHTML = `
    <div class="ov-panel" style="margin-bottom:14px;">
      <div class="ov-panel-head"><div class="ov-panel-title">Work order queue</div><div class="ov-panel-meta">${openWOs.length} open</div></div>
      <div class="ov-panel-body" style="padding:0 14px 6px;">
        <table class="ov-table"><tr><th>ID</th><th>Asset</th><th>Type</th><th>Priority</th><th>Status</th><th>Age</th></tr>${woRows || '<tr><td colspan="6" class="card-meta" style="padding:14px 0;">No open work orders.</td></tr>'}</table>
      </div>
    </div>

    <div class="ov-row-3">
      <div class="ov-panel">
        <div class="ov-panel-head"><div class="ov-panel-title">PM due soon</div><div class="ov-panel-meta">next up</div></div>
        <div class="ov-panel-body">${pmDueHtml}</div>
      </div>
      <div class="ov-panel">
        <div class="ov-panel-head"><div class="ov-panel-title">Meter readings</div><div class="ov-panel-meta">telemetry</div></div>
        <div class="ov-panel-body">${
          meterFetchFailed
            ? '<div class="card-meta">Could not reach the telemetry project.</div>'
            : metersBlocked
              ? '<div class="card-meta">Readings found, but the meters table isn\'t readable yet.</div>'
              : readingsBlocked
                ? '<div class="card-meta">Meters found, but readings aren\'t readable yet.</div>'
                : meterRows.length
                  ? meterRows.map(r => `
                      <div class="ov-meter-row">
                        <span class="ov-meter-name">${escapeHtml(r.meter.name)}</span>
                        <span class="ov-meter-val">${r.consumption != null ? r.consumption.toLocaleString() : '\u2014'}<span class="unit">${escapeHtml(r.meter.unit || '')}</span></span>
                      </div>`).join('')
                  : '<div class="card-meta">No readings logged yet.</div>'
        }</div>
      </div>
      <div class="ov-panel">
        <div class="ov-panel-head"><div class="ov-panel-title">Recent activity</div></div>
        <div class="ov-panel-body">${activityHtml}</div>
      </div>
    </div>
  `;
}