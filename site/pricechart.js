// Small price-history line chart (new + used) for the expanded card view.
// Inline SVG: 2px lines, ringed end dots, value at each line end, hairline grid,
// one y-axis, a legend, a crosshair tooltip on hover and a screen-reader table.

const W = 560;
const H = 180;
const M = { top: 14, right: 74, bottom: 24, left: 46 };
const GAP_DAYS = 7; // break the line across longer gaps in the data
const SERIES = [
  { key: 'new', label: 'New', cls: 's-new' },
  { key: 'used', label: 'Used', cls: 's-used' },
];

const dayMs = (d) => Date.parse(`${d}T12:00:00Z`);
const shortDate = (d) => new Date(dayMs(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function niceTicks(min, max, count = 3) {
  const span = max - min || max || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/** series: { new: [{day, price}], used: [...] } (oldest first). Returns HTML. */
export function priceChartHtml(series, money) {
  const present = SERIES.filter((s) => series[s.key]?.length >= 2);
  if (!present.length) return '';
  const all = present.flatMap((s) => series[s.key]);
  const days = [...new Set(all.map((p) => p.day))].sort();
  const x0 = dayMs(days[0]);
  const x1 = dayMs(days[days.length - 1]);
  const ticks = niceTicks(Math.min(...all.map((p) => p.price)), Math.max(...all.map((p) => p.price)));
  const [y0, y1] = [ticks[0], ticks[ticks.length - 1]];
  const sx = (d) => M.left + ((dayMs(d) - x0) / (x1 - x0 || 1)) * (W - M.left - M.right);
  const sy = (v) => M.top + (1 - (v - y0) / (y1 - y0 || 1)) * (H - M.top - M.bottom);
  const fmt = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : `$${Math.round(v)}`);

  const grid = ticks
    .map((t) => `<line class="grid" x1="${M.left}" x2="${W - M.right}" y1="${sy(t)}" y2="${sy(t)}"/><text class="tick" x="${M.left - 8}" y="${sy(t) + 4}" text-anchor="end">${fmt(t)}</text>`)
    .join('');
  const xLabels = [days[0], days[Math.floor(days.length / 2)], days[days.length - 1]]
    .filter((d, i, a) => a.indexOf(d) === i)
    .map((d, i, a) => `<text class="tick" x="${sx(d)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle'}">${shortDate(d)}</text>`)
    .join('');

  const ends = [];
  const lines = present.map((s) => {
    const pts = series[s.key];
    let d = '';
    pts.forEach((p, i) => {
      const gap = i > 0 && (dayMs(p.day) - dayMs(pts[i - 1].day)) / 864e5 > GAP_DAYS;
      d += `${i === 0 || gap ? 'M' : 'L'}${sx(p.day).toFixed(1)},${sy(p.price).toFixed(1)}`;
    });
    const last = pts[pts.length - 1];
    ends.push({ s, x: sx(last.day), y: sy(last.price), price: last.price });
    return `<path class="line ${s.cls}" d="${d}"/>`;
  });
  // Direct end labels only when they don't collide; otherwise legend + tooltip carry it.
  const labelEnds = ends.length < 2 || Math.abs(ends[0].y - ends[1].y) >= 14;
  const endMarks = ends
    .map((e) => `<circle class="dot ${e.s.cls}" cx="${e.x}" cy="${e.y}" r="4"/>${labelEnds ? `<text class="end" x="${e.x + 9}" y="${e.y + 4}">${esc(money(e.price))}</text>` : ''}`)
    .join('');

  // Per-day values for the tooltip.
  const byDay = days.map((day) => ({ day, ...Object.fromEntries(present.map((s) => [s.key, series[s.key].find((p) => p.day === day)?.price ?? null])) }));
  const data = esc(JSON.stringify({ x: byDay.map((r) => +sx(r.day).toFixed(1)), rows: byDay }));
  const legend = present.map((s) => `<span class="key"><i class="${s.cls}"></i>${s.label}</span>`).join('');
  const table = `<table class="sr-only"><caption>Price history</caption><thead><tr><th>Date</th>${present.map((s) => `<th>${s.label}</th>`).join('')}</tr></thead><tbody>${byDay
    .map((r) => `<tr><td>${shortDate(r.day)}</td>${present.map((s) => `<td>${r[s.key] != null ? esc(money(r[s.key])) : '—'}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;

  return `<div class="pchart" data-chart="${data}">
<div class="legend">${legend}</div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price history chart">${grid}${xLabels}${lines.join('')}
<line class="cross" x1="0" x2="0" y1="${M.top}" y2="${H - M.bottom}" visibility="hidden"/>${endMarks}
<rect class="hit" x="${M.left}" y="${M.top}" width="${W - M.left - M.right}" height="${H - M.top - M.bottom}"/></svg>
<div class="ptip" hidden></div>${table}</div>`;
}

/** Delegated crosshair + tooltip for every chart inside `root`. */
export function bindPriceCharts(root, money) {
  const hide = (chart) => {
    chart.querySelector('.cross')?.setAttribute('visibility', 'hidden');
    const tip = chart.querySelector('.ptip');
    if (tip) tip.hidden = true;
  };
  root.addEventListener('pointermove', (e) => {
    const chart = e.target.closest?.('.pchart');
    if (!chart || !e.target.closest('svg')) return;
    const svg = chart.querySelector('svg');
    const { x, rows } = JSON.parse(chart.dataset.chart);
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;
    let i = 0;
    for (let k = 1; k < x.length; k++) if (Math.abs(x[k] - vx) < Math.abs(x[i] - vx)) i = k;
    const cross = svg.querySelector('.cross');
    cross.setAttribute('x1', x[i]);
    cross.setAttribute('x2', x[i]);
    cross.setAttribute('visibility', 'visible');
    const r = rows[i];
    const tip = chart.querySelector('.ptip');
    tip.innerHTML = `<b>${shortDate(r.day)}</b>${SERIES.filter((s) => s.key in r)
      .map((s) => `<span><i class="${s.cls}"></i>${s.label}<em>${r[s.key] != null ? esc(money(r[s.key])) : '—'}</em></span>`)
      .join('')}`;
    tip.hidden = false;
    const px = (x[i] / W) * box.width;
    tip.style.left = `${Math.min(Math.max(px, 70), box.width - 70)}px`;
  });
  root.addEventListener('pointerout', (e) => {
    const chart = e.target.closest?.('.pchart');
    if (chart && !chart.contains(e.relatedTarget)) hide(chart);
  });
}
