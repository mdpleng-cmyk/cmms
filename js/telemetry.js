import { sbTelemetry, escapeHtml } from './store.js';

const WATER_TANK_CODES = ['RAW-TANK-VOLUME-02', 'SOFT-TANK-VOLUME-01', 'FIRE-TANK-VOLUME-03'];
const WATER_CONSUMPTION_CODE = 'WTP-CONSUMPTION';
const ELECTRICAL_CODE_PREFIX = 'PLT-ENERGY-';
const WATER_TREND_HOURS = 30;
const ELECTRICAL_RANGES = { '7d': 7, '30d': 30 };
const TANK_COLORS = ['#60a5fa', '#34d399', '#fbbf24'];
const ELECTRICAL_COLOR = '#f59e0b';
let selectedEnergyCodes = [];
let selectedEnergyRange = '7d';

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatValue(value, unit = 'L') {
  return value == null ? '—' : `${Number(value).toLocaleString()} ${unit}`;
}

function freshness(reading, intervalHours) {
  if (!reading) return { label: 'Missing data', cls: 'missing' };
  const ageHours = (Date.now() - new Date(reading.recorded_at).getTime()) / 3600000;
  return { label: ageHours > intervalHours * 2.5 ? 'Stale' : 'Current', cls: ageHours > intervalHours * 2.5 ? 'stale' : 'current' };
}

function statusBadge(status) {
  return `<span class="telemetry-status ${status.cls}">${status.label}</span>`;
}

function renderStatusCard(label, reading, unit, intervalHours) {
  const status = freshness(reading, intervalHours);
  return `<div class="telemetry-status-card">
    <div class="telemetry-card-label">${escapeHtml(label)}</div>
    <div class="telemetry-card-value">${formatValue(reading?.value, unit)}</div>
    <div class="telemetry-card-meta">${statusBadge(status)}${reading ? ` <span>${formatTime(reading.recorded_at)}</span>` : ''}</div>
  </div>`;
}

function renderSvgChart({ series, colors, unit, title, emptyMessage, bars = false }) {
  if (!series.length || series.some(item => item.readings.length < 2)) {
    return `<div class="telemetry-chart-empty">${escapeHtml(emptyMessage)}</div>`;
  }
  const allReadings = series.flatMap(item => item.readings);
  const width = 900;
  const height = 290;
  const pad = { top: 18, right: 22, bottom: 42, left: 64 };
  const minTime = Math.min(...allReadings.map(r => new Date(r.recorded_at).getTime()));
  const maxTime = Math.max(...allReadings.map(r => new Date(r.recorded_at).getTime()));
  const minValue = Math.min(0, ...allReadings.map(r => Number(r.value)));
  const maxValue = Math.max(...allReadings.map(r => Number(r.value)));
  const range = maxValue === minValue ? 1 : maxValue - minValue;
  const x = time => pad.left + ((time - minTime) / Math.max(1, maxTime - minTime)) * (width - pad.left - pad.right);
  const y = value => pad.top + (1 - (value - minValue) / range) * (height - pad.top - pad.bottom);
  const yTicks = Array.from({ length: 5 }, (_, i) => minValue + range * i / 4);
  const xTicks = [minTime, minTime + (maxTime - minTime) / 2, maxTime];
  const grid = yTicks.map(value => `<line x1="${pad.left}" y1="${y(value)}" x2="${width - pad.right}" y2="${y(value)}" class="water-grid-line" /><text x="${pad.left - 8}" y="${y(value) + 4}" text-anchor="end" class="water-axis-label">${Math.round(value).toLocaleString()}</text>`).join('');
  const labels = xTicks.map(time => `<text x="${x(time)}" y="${height - 12}" text-anchor="middle" class="water-axis-label">${formatTime(time).split(', ').pop()}</text>`).join('');
  const marks = series.map((item, index) => {
    if (bars) {
      const barWidth = Math.max(5, (width - pad.left - pad.right) / Math.max(1, item.readings.length) * .6);
      return item.readings.map(reading => {
        const time = new Date(reading.recorded_at).getTime();
        const top = y(Math.max(0, Number(reading.value)));
        const bottom = y(0);
        return `<rect x="${x(time) - barWidth / 2}" y="${Math.min(top, bottom)}" width="${barWidth}" height="${Math.max(1, Math.abs(bottom - top))}" fill="${colors[index]}" opacity=".82"><title>${escapeHtml(`${formatTime(reading.recorded_at)} | ${item.label}: ${formatValue(reading.value, unit)}`)}</title></rect>`;
      }).join('');
    }
    const points = item.readings.map(reading => `${x(new Date(reading.recorded_at).getTime())},${y(Number(reading.value))}`).join(' ');
    const dots = item.readings.map(reading => {
      const time = new Date(reading.recorded_at).getTime();
      const tooltip = [formatTime(reading.recorded_at), ...series.map(other => {
        const nearest = other.readings.reduce((best, candidate) => !best || Math.abs(new Date(candidate.recorded_at) - time) < Math.abs(new Date(best.recorded_at) - time) ? candidate : best, null);
        return `${other.label}: ${formatValue(nearest?.value, unit)}`;
      })].join(' | ');
      return `<circle cx="${x(time)}" cy="${y(Number(reading.value))}" r="4" fill="${colors[index]}" class="water-point"><title>${escapeHtml(tooltip)}</title></circle>`;
    }).join('');
    return `<polyline points="${points}" fill="none" stroke="${colors[index]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />${dots}`;
  }).join('');
  const legend = series.map((item, index) => `<span class="water-legend-item"><i style="background:${colors[index]}"></i>${escapeHtml(item.label)}</span>`).join('');
  return `<div class="telemetry-chart-title">${escapeHtml(title)}</div><div class="water-chart-legend">${legend}</div><svg class="water-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)} trend chart"><text x="14" y="${height / 2}" transform="rotate(-90 14 ${height / 2})" class="water-axis-label">${escapeHtml(unit)}</text>${grid}${marks}${labels}</svg>`;
}

async function fetchMeters(codes = null) {
  let query = sbTelemetry.from('meters').select('id, meter_code, name, location, meter_group, unit, meter_type, reading_mode, active');
  if (codes) query = query.in('meter_code', codes);
  const { data, error } = await query.order('meter_code');
  return { data: data || [], error };
}

async function fetchReadings(meterIds, since) {
  return sbTelemetry.from('meter_readings')
    .select('meter_id, reading_value, consumption, recorded_at, reading_date')
    .in('meter_id', meterIds)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true });
}

function latestReading(readings, meterId, valueKey) {
  const rows = readings.filter(row => row.meter_id === meterId && row[valueKey] != null);
  return rows.at(-1) ? { recorded_at: rows.at(-1).recorded_at, value: rows.at(-1)[valueKey] } : null;
}

async function loadWaterData() {
  const codes = [...WATER_TANK_CODES, WATER_CONSUMPTION_CODE];
  const { data: meters, error: meterError } = await fetchMeters(codes);
  if (meterError) return { error: meterError };
  const byCode = Object.fromEntries(meters.map(meter => [meter.meter_code, meter]));
  const missing = codes.filter(code => !byCode[code]);
  if (missing.length) return { error: new Error(`Missing meters: ${missing.join(', ')}`) };
  const since = new Date(Date.now() - WATER_TREND_HOURS * 3600000).toISOString();
  const { data: readings, error: readingError } = await fetchReadings(meters.map(meter => meter.id), since);
  if (readingError) return { error: readingError };
  const makeSeries = (code, label, field) => ({ label, readings: readings.filter(row => row.meter_id === byCode[code].id && row[field] != null).map(row => ({ recorded_at: row.recorded_at, value: row[field] })) });
  return {
    meters: byCode,
    readings,
    tankSeries: WATER_TANK_CODES.map(code => makeSeries(code, `${byCode[code].name} tank`, 'reading_value')),
    consumptionSeries: [makeSeries(WATER_CONSUMPTION_CODE, 'Water consumption', 'consumption')],
    tankUnit: byCode[WATER_TANK_CODES[0]].unit || 'L',
    consumptionUnit: byCode[WATER_CONSUMPTION_CODE].unit || 'L',
  };
}

async function loadElectricalData(range = selectedEnergyRange) {
  const { data: meters, error: meterError } = await fetchMeters();
  if (meterError) return { error: meterError };
  const electricalAll = meters.filter(meter => meter.meter_code.startsWith(ELECTRICAL_CODE_PREFIX));
  const electrical = electricalAll.filter(meter => meter.active);
  const since = new Date(Date.now() - ELECTRICAL_RANGES[range] * 86400000).toISOString();
  const { data: readings, error: readingError } = await fetchReadings(electrical.map(meter => meter.id), since);
  if (readingError) return { error: readingError };
  const latest = electrical.map(meter => ({ meter, reading: latestReading(readings || [], meter.id, 'consumption') })).sort((a, b) => (b.reading?.value ?? -Infinity) - (a.reading?.value ?? -Infinity));
  return { meters: electrical, readings: readings || [], latest, inactiveCount: electricalAll.length - electrical.length, unit: electrical[0]?.unit || 'kWh' };
}

function renderCurrentWater(data) {
  const cards = WATER_TANK_CODES.map(code => {
    const meter = data.meters[code];
    return renderStatusCard(`${meter.name} Tank`, latestReading(data.readings, meter.id, 'reading_value'), meter.unit, 1);
  });
  const meter = data.meters[WATER_CONSUMPTION_CODE];
  cards.push(renderStatusCard('Water Consumption', latestReading(data.readings, meter.id, 'consumption'), `${meter.unit}/hour`, 1));
  return `<div class="telemetry-cards">${cards.join('')}</div>`;
}

function renderElectricalRanking(data) {
  const available = data.latest.filter(item => item.reading);
  if (!available.length) return '<div class="telemetry-chart-empty">No recent electrical consumption readings.</div>';
  const max = Math.max(...available.map(item => Number(item.reading.value)), 1);
  return `<div class="energy-ranking">${available.slice(0, 12).map(item => `<div class="energy-row"><div class="energy-row-label"><span>${escapeHtml(item.meter.name)}</span><b>${formatValue(item.reading.value, data.unit)}</b></div><div class="energy-bar"><span style="width:${Math.max(2, Number(item.reading.value) / max * 100)}%"></span></div></div>`).join('')}</div>`;
}

function renderElectricalTrend(data) {
  const selected = data.meters.filter(meter => selectedEnergyCodes.includes(meter.meter_code));
  if (!selected.length) return '<div class="telemetry-chart-empty">Select an electrical meter to view its consumption trend.</div>';
  const series = selected.map(meter => ({ label: meter.name, readings: data.readings.filter(row => row.meter_id === meter.id && row.consumption != null).map(row => ({ recorded_at: row.recorded_at, value: row.consumption })) }));
  return renderSvgChart({ title: 'Electrical consumption trend', series, colors: selected.map(() => ELECTRICAL_COLOR), unit: data.unit, emptyMessage: 'Insufficient history for this electrical trend.' });
}

function renderElectricalControls(data) {
  const options = data.meters.filter(meter => meter.active).map(meter => `<option value="${escapeHtml(meter.meter_code)}" ${selectedEnergyCodes.includes(meter.meter_code) ? 'selected' : ''}>${escapeHtml(meter.name)} · ${escapeHtml(meter.meter_code)}</option>`).join('');
  return `<div class="telemetry-controls"><label>Meter<select id="energy-meter-select" multiple size="4">${options}</select></label><label>Range<select id="energy-range-select"><option value="7d" ${selectedEnergyRange === '7d' ? 'selected' : ''}>Last 7 days</option><option value="30d" ${selectedEnergyRange === '30d' ? 'selected' : ''}>Last 30 days</option></select></label><button class="ghost" id="energy-apply-btn" type="button">Apply</button></div>`;
}

export async function loadTelemetry() {
  const el = document.getElementById('tab-telemetry');
  el.innerHTML = '<div class="readout-empty" style="padding-top:60px;">Loading telemetry...</div>';
  const [water, electrical] = await Promise.all([loadWaterData(), loadElectricalData()]);
  const waterHtml = water.error
    ? '<div class="telemetry-chart-empty">Could not reach the telemetry project or required water meters are missing.</div>'
    : `<section class="telemetry-section"><div class="telemetry-section-heading"><div><div class="eyebrow">Water</div><h2>Plant water status</h2></div><div class="card-meta">Live · 30-hour window</div></div>${renderCurrentWater(water)}<div class="telemetry-chart-grid"><div class="water-chart panel">${renderSvgChart({ title: 'Tank levels', series: water.tankSeries, colors: TANK_COLORS, unit: water.tankUnit, emptyMessage: 'Insufficient recent data for a 30-hour tank trend.' })}</div><div class="water-chart panel"><div class="telemetry-chart-title">Water consumption</div><div class="water-chart-subtitle">Hourly generated consumption</div>${renderSvgChart({ title: 'Water consumption', series: water.consumptionSeries, colors: ['#f97316'], unit: `${water.consumptionUnit}/hour`, bars: true, emptyMessage: 'Insufficient recent data for a 30-hour consumption trend.' })}</div></div></section>`;
  const electricalHtml = electrical.error
    ? '<div class="telemetry-chart-empty">Could not reach the telemetry project.</div>'
    : `<section class="telemetry-section"><div class="telemetry-section-heading"><div><div class="eyebrow">Electrical Energy</div><h2>Daily plant consumption</h2></div><div class="card-meta">${electrical.meters.length} active meters · ${electrical.inactiveCount} inactive · daily readings</div></div><div class="telemetry-panel-grid"><div class="panel"><div class="telemetry-chart-title">Latest consumption ranking</div>${renderElectricalRanking(electrical)}</div><div class="panel"><div class="telemetry-chart-title">Compare meters</div>${renderElectricalControls(electrical)}<div id="energy-trend-chart">${renderElectricalTrend(electrical)}</div></div></div></section>`;
  el.innerHTML = `<div class="telemetry-page"><div class="telemetry-page-heading"><div><div class="eyebrow">Telemetry</div><h1>Plant Utilities</h1></div><div class="card-meta">Live telemetry</div></div>${waterHtml}${electricalHtml}</div>`;
  const meterSelect = document.getElementById('energy-meter-select');
  const rangeSelect = document.getElementById('energy-range-select');
  const apply = document.getElementById('energy-apply-btn');
  if (meterSelect && rangeSelect && apply) {
    apply.onclick = async () => {
      selectedEnergyCodes = [...meterSelect.selectedOptions].map(option => option.value);
      selectedEnergyRange = rangeSelect.value;
      const refreshed = await loadElectricalData(selectedEnergyRange);
      const chart = document.getElementById('energy-trend-chart');
      if (chart) chart.innerHTML = refreshed.error ? '<div class="telemetry-chart-empty">Could not reach the telemetry project.</div>' : renderElectricalTrend(refreshed);
    };
  }
  lucide.createIcons({ root: el });
}
