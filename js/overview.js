import { sb, sbTelemetry, state, escapeHtml, formatDate } from './store.js';

export async function loadOverview() {
  const el = document.getElementById('tab-overview');
  el.innerHTML = `<div class="readout-empty" style="padding-top:60px;">Loading overview...</div>`;

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayISO = new Date().toISOString().slice(0,10);

  const [openRes, closedRes, schedRes, assetsRes, visitsRes, readingsRes, metersRes] = await Promise.all([
    sb.from('work_orders').select('id, type, status, opened_at, asset_id, assets(name, criticality, location)').in('status', ['open','in_progress','waiting_parts']).order('opened_at', { ascending: true }),
    sb.from('work_orders').select('id, opened_at, closed_at').eq('status', 'closed').gte('closed_at', todayStart.toISOString()),
    sb.from('recurring_schedules').select('id, title, next_due_at, active, asset_id, assets(name)').eq('active', true).order('next_due_at', { ascending: true }),
    sb.from('assets').select('id, name, location'),
    sb.from('wo_visits').select('visit_type, action_taken, technician, visited_at, wo_id, work_orders(id, asset_id, assets(name))').order('visited_at', { ascending: false }).limit(8),
    sbTelemetry.from('meter_readings').select('meter_id, reading_value, consumption, recorded_at, shift').order('recorded_at', { ascending: false }).limit(200).then(r => r).catch(() => ({ data: null, error: true })),
    sbTelemetry.from('meters').select('id, name, unit, active').eq('active', true).then(r => r).catch(() => ({ data: null, error: true })),
  ]);

  const openWOs = openRes.data || [];
  const closedToday = closedRes.data || [];
  const schedules = schedRes.data || [];
  const assets = assetsRes.data || [];
  const visits = visitsRes.data || [];

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

  // ---- KPIs ----
  const breakdownCount = openWOs.filter(w => w.type === 'breakdown').length;
  const pmCount = openWOs.filter(w => w.type === 'pm').length;

  const overdueSchedules = schedules.filter(s => s.next_due_at < todayISO);
  const oldestOverdueDays = overdueSchedules.length
    ? Math.max(...overdueSchedules.map(s => Math.round((todayStart - new Date(s.next_due_at)) / 86400000)))
    : 0;

  const criticalDown = openWOs.filter(w => w.type === 'breakdown' && ['P1','P2'].includes(w.assets?.criticality));
  const criticalLabel = criticalDown.length ? criticalDown[0].assets?.name : 'None';

  const avgCloseMin = closedToday.length
    ? Math.round(closedToday.reduce((s, w) => s + (new Date(w.closed_at) - new Date(w.opened_at)) / 60000, 0) / closedToday.length)
    : null;

  const zoneCount = new Set(assets.map(a => a.location || 'Unassigned')).size;

  // ---- Zones ----
  const zoneMap = {};
  assets.forEach(a => {
    const z = a.location || 'Unassigned';
    (zoneMap[z] = zoneMap[z] || { assets: [], openWO: 0, hasCriticalDown: false }).assets.push(a);
  });
  openWOs.forEach(w => {
    const z = w.assets?.location || 'Unassigned';
    if (!zoneMap[z]) zoneMap[z] = { assets: [], openWO: 0, hasCriticalDown: false };
    zoneMap[z].openWO++;
    if (w.type === 'breakdown' && ['P1','P2'].includes(w.assets?.criticality)) zoneMap[z].hasCriticalDown = true;
  });

  const zoneHtml = Object.entries(zoneMap).map(([name, z]) => {
    const tone = z.hasCriticalDown ? 'crit' : z.openWO > 0 ? 'warn' : 'ok';
    return `
      <div class="ov-zone ${tone}">
        <div class="ov-zone-name">${escapeHtml(name)}</div>
        <div class="ov-zone-stat">${z.assets.length} assets &middot; <b>${z.openWO}</b> open WO</div>
      </div>`;
  }).join('') || '<div class="card-meta">No assets yet.</div>';

  // ---- WO queue table ----
  const priorityFor = c => c === 'P1' ? ['Critical','crit'] : c === 'P2' ? ['High','warn'] : ['Normal','ok'];
  const woRows = openWOs.slice(0, 8).map(w => {
    const [label, tone] = priorityFor(w.assets?.criticality);
    const ageMs = Date.now() - new Date(w.opened_at).getTime();
    const ageH = Math.floor(ageMs / 3600000);
    const ageStr = ageH >= 24 ? `${Math.floor(ageH/24)}d ${ageH%24}h` : `${ageH}h`;
    return `
      <tr style="cursor:pointer;" onclick="window.openWoDetailModal(${w.id})">
        <td class="ov-wo-id">#${w.id}</td>
        <td>${escapeHtml(w.assets?.name || 'Unknown')}</td>
        <td>${w.type}</td>
        <td><span class="badge ${tone === 'crit' ? 'breakdown' : ''}" style="font-size:10px;">${label}</span></td>
        <td><span class="badge ${w.status}" style="font-size:10px;">${w.status.replace('_',' ')}</span></td>
        <td class="ov-wo-id">${ageStr}</td>
      </tr>`;
  }).join('');

  // ---- PM due soon ----
  const pmDueHtml = schedules.slice(0, 6).map(s => {
    const days = Math.round((new Date(s.next_due_at) - todayStart) / 86400000);
    const cls = days < 0 ? 'over' : days <= 3 ? 'soon' : '';
    const label = days < 0 ? `${days}d` : days === 0 ? 'Today' : `${days}d`;
    const assetName = (s.assets?.name || '').replace(/'/g, "\\'");
    return `
      <div class="ov-pm-due-item" style="cursor:pointer;" onclick="window.openAssetHistoryModal(${s.asset_id}, '${assetName}')">
        <span>${escapeHtml(s.assets?.name || '')} &mdash; ${escapeHtml(s.title)}</span>
        <span class="ov-pm-due-days ${cls}">${label}</span>
      </div>`;
  }).join('') || '<div class="card-meta">No active PM schedules.</div>';

  // ---- Activity feed ----
  const activityHtml = visits.length ? visits.map(v => {
    const assetId = v.work_orders?.asset_id;
    const assetName = (v.work_orders?.assets?.name || '').replace(/'/g, "\\'");
    return `
    <div class="ov-activity-item" ${assetId ? `style="cursor:pointer;" onclick="window.openAssetHistoryModal(${assetId}, '${assetName}')"` : ''}>
      <span class="ov-activity-time">${formatDate(v.visited_at).split(',')[1] || formatDate(v.visited_at)}</span>
      <span class="ov-activity-text"><b>${escapeHtml(v.technician || 'Someone')}</b> ${v.visit_type} &middot; ${escapeHtml(v.work_orders?.assets?.name || 'WO #' + v.wo_id)}</span>
    </div>`;
  }).join('') : '<div class="card-meta">No recent activity.</div>';

  el.innerHTML = `
    <div class="ov-kpi-row">
      <div class="ov-kpi"><div class="ov-kpi-label">Open work orders</div><div class="ov-kpi-value">${openWOs.length}</div><div class="ov-kpi-delta">${breakdownCount} breakdown &middot; ${pmCount} PM</div></div>
      <div class="ov-kpi"><div class="ov-kpi-label">Overdue PM</div><div class="ov-kpi-value ${overdueSchedules.length ? 'warn' : ''}">${overdueSchedules.length}</div><div class="ov-kpi-delta">${overdueSchedules.length ? `oldest ${oldestOverdueDays}d` : 'none'}</div></div>
      <div class="ov-kpi"><div class="ov-kpi-label">Critical assets down</div><div class="ov-kpi-value ${criticalDown.length ? 'crit' : ''}">${criticalDown.length}</div><div class="ov-kpi-delta">${escapeHtml(criticalLabel)}</div></div>
      <div class="ov-kpi"><div class="ov-kpi-label">Closed today</div><div class="ov-kpi-value ok">${closedToday.length}</div><div class="ov-kpi-delta">${avgCloseMin !== null ? `avg ${avgCloseMin}m to close` : 'none yet'}</div></div>
      <div class="ov-kpi"><div class="ov-kpi-label">Assets tracked</div><div class="ov-kpi-value">${assets.length}</div><div class="ov-kpi-delta">across ${zoneCount} zones</div></div>
    </div>

    <div class="ov-grid">
      <div class="ov-stack">
        <div class="ov-panel">
          <div class="ov-panel-head"><div class="ov-panel-title">Plant zones</div><div class="ov-panel-meta">live status</div></div>
          <div class="ov-panel-body"><div class="ov-zone-map">${zoneHtml}</div></div>
        </div>
        <div class="ov-panel">
          <div class="ov-panel-head"><div class="ov-panel-title">Work order queue</div><div class="ov-panel-meta">${openWOs.length} open</div></div>
          <div class="ov-panel-body" style="padding:0 14px 6px;">
            <table class="ov-table"><tr><th>ID</th><th>Asset</th><th>Type</th><th>Priority</th><th>Status</th><th>Age</th></tr>${woRows || '<tr><td colspan="6" class="card-meta" style="padding:14px 0;">No open work orders.</td></tr>'}</table>
          </div>
        </div>
      </div>

      <div class="ov-stack">
        <div class="ov-panel">
          <div class="ov-panel-head"><div class="ov-panel-title">PM due soon</div><div class="ov-panel-meta">next up</div></div>
          <div class="ov-panel-body">${pmDueHtml}</div>
        </div>
        <div class="ov-panel">
          <div class="ov-panel-head"><div class="ov-panel-title">Meter readings</div><div class="ov-panel-meta">telemetry</div></div>
          <div class="ov-panel-body">${
            meterFetchFailed
              ? '<div class="card-meta">Could not reach the telemetry project.</div>'
              : meterRows.length
                ? meterRows.map(r => `
                    <div class="ov-meter-row">
                      <span class="ov-meter-name">${escapeHtml(r.meter.name)}</span>
                      <span class="ov-meter-val">${r.consumption != null ? r.consumption.toLocaleString() : '\u2014'}<span class="unit">${escapeHtml(r.meter.unit || '')} / interval</span></span>
                    </div>`).join('')
                : '<div class="card-meta">No readings logged yet.</div>'
          }</div>
        </div>
        <div class="ov-panel">
          <div class="ov-panel-head"><div class="ov-panel-title">Recent activity</div></div>
          <div class="ov-panel-body">${activityHtml}</div>
        </div>
      </div>
    </div>
  `;
}