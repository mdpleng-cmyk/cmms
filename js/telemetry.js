import { sbTelemetry, escapeHtml } from './store.js';

const WATER_TANK_CODES = ['RAW-TANK-VOLUME-02', 'SOFT-TANK-VOLUME-01', 'FIRE-TANK-VOLUME-03'];
const WATER_CONSUMPTION_CODE = 'WTP-CONSUMPTION';
const WATER_TREND_HOURS = 30;
const WATER_SERIES_COLORS = ['#60a5fa', '#34d399', '#fbbf24'];

function formatTrendTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTrendValue(value, unit) {
  return value == null ? 'No reading' : `${Number(value).toLocaleString()} ${unit}`;
}

function renderWaterChart({ title, subtitle, series, colors, unit, valueLabel, emptyMessage }) {
  const allReadings = series.flatMap(s => s.readings);
  const hasEnoughData = series.every(s => s.readings.length >= 2);
  if (!hasEnoughData) {
    return `<div class="water-chart panel">
      <div class="water-chart-title">${escapeHtml(title)}</div>
      <div class="water-chart-subtitle">${escapeHtml(subtitle)}</div>
      <div class="water-chart-empty">${escapeHtml(emptyMessage)}</div>
    </div>`;
  }

  const width = 720;
  const height = 250;
  const pad = { top: 18, right: 20, bottom: 38, left: 58 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const times = allReadings.map(r => new Date(r.recorded_at).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minValue = Math.min(...allReadings.map(r => Number(r.value)));
  const maxValue = Math.max(...allReadings.map(r => Number(r.value)));
  const valueRange = maxValue === minValue ? 1 : maxValue - minValue;
  const xFor = time => pad.left + ((time - minTime) / Math.max(1, maxTime - minTime)) * plotWidth;
  const yFor = value => pad.top + (1 - (value - minValue) / valueRange) * plotHeight;
  const yTicks = Array.from({ length: 5 }, (_, i) => minValue + (valueRange * i / 4));
  const timeTicks = [minTime, minTime + (maxTime - minTime) / 2, maxTime];
  const latestBySeries = series.map(s => s.readings.at(-1));

  const grid = yTicks.map(value => {
    const y = yFor(value);
    return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="water-grid-line" />
      <text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" class="water-axis-label">${Math.round(value).toLocaleString()}</text>`;
  }).join('');
  const xLabels = timeTicks.map(time => `<text x="${xFor(time)}" y="${height - 12}" text-anchor="middle" class="water-axis-label">${formatTrendTime(time).split(', ').pop()}</text>`).join('');
  const paths = series.map((item, index) => {
    const points = item.readings.map(r => `${xFor(new Date(r.recorded_at).getTime())},${yFor(Number(r.value))}`).join(' ');
    const dots = item.readings.map(r => {
      const time = new Date(r.recorded_at).getTime();
      const tooltip = [
        formatTrendTime(r.recorded_at),
        ...series.map(other => {
          const nearest = other.readings.reduce((best, candidate) => {
            if (!best) return candidate;
            return Math.abs(new Date(candidate.recorded_at) - time) < Math.abs(new Date(best.recorded_at) - time) ? candidate : best;
          }, null);
          return `${other.label}: ${formatTrendValue(nearest?.value, unit)}`;
        }),
      ].join(' | ');
      return `<circle cx="${xFor(time)}" cy="${yFor(Number(r.value))}" r="4" fill="${colors[index]}" class="water-point"><title>${escapeHtml(tooltip)}</title></circle>`;
    }).join('');
    return `<polyline points="${points}" fill="none" stroke="${colors[index]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />${dots}`;
  }).join('');
  const legend = series.map((item, index) => `<span class="water-legend-item"><i style="background:${colors[index]}"></i>${escapeHtml(item.label)}</span>`).join('');
  const latest = latestBySeries.map((reading, index) => `${escapeHtml(series[index].label)} ${formatTrendValue(reading?.value, unit)}`).join(' &middot; ');

  return `<div class="water-chart panel">
    <div class="water-chart-heading"><div><div class="water-chart-title">${escapeHtml(title)}</div><div class="water-chart-subtitle">${escapeHtml(subtitle)}</div></div><div class="water-chart-latest">${latest}</div></div>
    <div class="water-chart-legend">${legend}</div>
    <svg class="water-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)} trend chart">
      <text x="14" y="${pad.top + plotHeight / 2}" transform="rotate(-90 14 ${pad.top + plotHeight / 2})" class="water-axis-label">${escapeHtml(valueLabel)}</text>
      ${grid}${paths}${xLabels}
    </svg>
  </div>`;
}

async function loadWaterTrend() {
  const since = new Date(Date.now() - WATER_TREND_HOURS * 60 * 60 * 1000).toISOString();
  const codes = [...WATER_TANK_CODES, WATER_CONSUMPTION_CODE];
  const { data: meters, error: metersError } = await sbTelemetry.from('meters')
    .select('id, meter_code, name, unit, meter_type, reading_mode, active')
    .in('meter_code', codes)
    .eq('active', true);
  if (metersError) return { error: metersError };

  const meterByCode = Object.fromEntries((meters || []).map(m => [m.meter_code, m]));
  const missingCodes = codes.filter(code => !meterByCode[code]);
  if (missingCodes.length) return { error: new Error(`Missing telemetry meters: ${missingCodes.join(', ')}`) };

  const { data: readings, error: readingsError } = await sbTelemetry.from('meter_readings')
    .select('meter_id, reading_value, consumption, recorded_at')
    .in('meter_id', meters.map(m => m.id))
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true });
  if (readingsError) return { error: readingsError };

  const readingsById = {};
  (readings || []).forEach(reading => {
    (readingsById[reading.meter_id] ||= []).push(reading);
  });
  const makeSeries = (code, label, valueKey) => ({
    label,
    readings: (readingsById[meterByCode[code].id] || [])
      .filter(r => r[valueKey] != null)
      .map(r => ({ recorded_at: r.recorded_at, value: r[valueKey] })),
  });
  return {
    tankUnit: meterByCode[WATER_TANK_CODES[0]].unit || 'L',
    consumptionUnit: meterByCode[WATER_CONSUMPTION_CODE].unit || 'L',
    tankSeries: [
      makeSeries('RAW-TANK-VOLUME-02', 'Raw tank', 'reading_value'),
      makeSeries('SOFT-TANK-VOLUME-01', 'Soft tank', 'reading_value'),
      makeSeries('FIRE-TANK-VOLUME-03', 'Fire tank', 'reading_value'),
    ],
    consumptionSeries: [makeSeries('WTP-CONSUMPTION', 'Water consumption', 'consumption')],
  };
}

export async function loadTelemetry() {
  const el = document.getElementById('tab-telemetry');
  el.innerHTML = '<div class="readout-empty" style="padding-top:60px;">Loading telemetry...</div>';
  const waterRes = await loadWaterTrend().catch(error => ({ error }));
  const waterHtml = waterRes.error
    ? `<div class="water-chart panel"><div class="water-chart-title">Water Tank Levels</div><div class="water-chart-empty">Could not reach the telemetry project.</div></div>
       <div class="water-chart panel"><div class="water-chart-title">Water Consumption</div><div class="water-chart-empty">Could not reach the telemetry project.</div></div>`
    : `${renderWaterChart({
        title: 'Water Tank Levels',
        subtitle: 'Last 30 hours · actual level readings',
        series: waterRes.tankSeries,
        colors: WATER_SERIES_COLORS,
        unit: waterRes.tankUnit,
        valueLabel: waterRes.tankUnit,
        emptyMessage: 'Insufficient recent data for a 30-hour tank trend.',
      })}${renderWaterChart({
        title: 'Water Consumption',
        subtitle: 'Last 30 hours · generated consumption',
        series: waterRes.consumptionSeries,
        colors: ['#f97316'],
        unit: `${waterRes.consumptionUnit}/hour`,
        valueLabel: `${waterRes.consumptionUnit}/hour`,
        emptyMessage: 'Insufficient recent data for a 30-hour consumption trend.',
      })}`;

  el.innerHTML = `<div class="telemetry-page">
    <div class="telemetry-page-heading"><div><div class="eyebrow">Telemetry</div><h2>Water</h2></div><div class="card-meta">Live telemetry · last 30 hours</div></div>
    <div class="ov-water-grid">${waterHtml}</div>
  </div>`;
  lucide.createIcons({ root: el });
}
