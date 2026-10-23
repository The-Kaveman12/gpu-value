// GPU Value: client-side filtering, sorting and rendering.

import { addToCompare, buildComparison, decodeCompare, encodeCompare, MAX_COMPARE, removeFromCompare } from './compare.js';
import { FEATURE_GROUPS, FEATURES } from './features.js';
import { dealOf, isDeal, seriesFor, stats } from './history.js';
import { derive as deriveRows, priceOf, SORT_DIR, searchText, vendorKey } from './logic.js';
import { bindPriceCharts, priceChartHtml } from './pricechart.js';

const PAGE = 50;
const DEFAULT_STALE_HOURS = 48;
const MIN_LISTINGS = 3;
const DEFAULTS = { q: '', res: '1440p', work: 'raster', basis: 'new', vendors: [], tech: [], minVram: 0, maxPrice: null, minFps: null, segment: 'desktop', sort: 'value', dir: null, rankedOnly: false, watchOnly: false, dealsOnly: false, cmp: [], cmpView: false, cmpDiff: false };
const RES_LABEL = { '1080p': '1080p', '1440p': '1440p', '4k': '4K' };
const WORK_LABEL = { raster: 'raster', rt: 'ray tracing', mixed: 'mixed' };
const BASIS_LABEL = { new: 'new', used: 'used', msrp: 'MSRP' };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Whole-dollar amounts without cents; otherwise keep the cents (so $599.99 never shows as $600).
const money = (n) => (n == null ? '—' : `$${n.toLocaleString('en-US', Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const count = (v) => Number(v).toLocaleString('en-US');
const fmtDate = (d) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown');
function ago(iso) {
  const h = (Date.now() - new Date(iso)) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
const hoursOld = (iso) => (Date.now() - new Date(iso)) / 36e5;
const staleAfter = (source) => PRICES.sources?.[source]?.staleAfterHours ?? DEFAULT_STALE_HOURS;
const isStale = (q) => q?.fetched && hoursOld(q.fetched) > staleAfter(q.source);
const SOURCE_SHORT = { retail: 'retail', ebay: 'eBay', hardwaredeals: 'eBay snapshot' };
const SOURCE_HINT = {
  retail: "Best current US retail price from Tom's Hardware's GPU price tracker",
  ebay: 'Median of the 5 cheapest matching eBay Buy It Now listings (live API)',
  hardwaredeals: "Median of the cheapest matching listings in HardwareDeals.co's daily eBay snapshot (no seller ratings or shipping)",
};

let DATA = { gpus: [], sources: {} };
let PRICES = { cards: {}, sources: {} };
let HISTORY = null; // price history (site/data/history.json)
let ALERTS = []; // open price-alert issues (site/data/alerts.json)
let WATCH = new Set(); // starred card ids, kept in this browser
let state = { ...DEFAULTS };
let limit = PAGE;
const open = new Set();

// --- URL state ---------------------------------------------------------------
function readUrl() {
  const p = new URLSearchParams(location.search);
  const s = { ...DEFAULTS };
  for (const k of ['q', 'res', 'work', 'basis', 'segment', 'sort', 'dir']) if (p.has(k)) s[k] = p.get(k);
  if (p.has('vendors')) s.vendors = p.get('vendors').split(',').filter(Boolean);
  if (p.has('tech')) s.tech = p.get('tech').split(',').filter((id) => FEATURES.some((f) => f.id === id));
  if (p.has('minVram')) s.minVram = Number(p.get('minVram')) || 0;
  if (p.has('maxPrice')) s.maxPrice = Number(p.get('maxPrice')) || null;
  if (p.has('minFps')) s.minFps = Number(p.get('minFps')) || null;
  s.rankedOnly = p.get('ranked') === '1';
  s.watchOnly = p.get('watch') === '1';
  s.dealsOnly = p.get('deals') === '1';
  s.cmp = decodeCompare(p.get('cmp'), new Set(DATA.gpus.map((g) => g.id)));
  s.cmpView = p.get('cmpview') === '1' && s.cmp.length >= 2;
  s.cmpDiff = p.get('cmpdiff') === '1';
  return s;
}
function writeUrl() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (k === 'rankedOnly') { if (v) p.set('ranked', '1'); continue; }
    if (k === 'watchOnly') { if (v) p.set('watch', '1'); continue; }
    if (k === 'dealsOnly') { if (v) p.set('deals', '1'); continue; }
    if (k === 'cmp') { if (v.length) p.set('cmp', encodeCompare(v)); continue; }
    if (k === 'cmpView') { if (v) p.set('cmpview', '1'); continue; }
    if (k === 'cmpDiff') { if (v) p.set('cmpdiff', '1'); continue; }
    const def = DEFAULTS[k];
    const val = Array.isArray(v) ? v.join(',') : v;
    if (val !== null && val !== '' && String(val) !== String(Array.isArray(def) ? def.join(',') : def)) p.set(k, val);
  }
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// --- Rendering -------------------------------------------------------------------
const CHEVRON = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';

function gpuSubtitle(g) {
  return [g.vendor, g.architecture, g.gpuName, g.releaseDate?.slice(0, 4)].filter(Boolean).join(' · ');
}

function tags(g, price) {
  const t = [];
  if (g.directX === '12.2') t.push('<span class="tag" title="Supports DirectX 12 Ultimate (hardware ray tracing, mesh shaders)">DX12U</span>');
  if (g.segment === 'workstation') t.push('<span class="tag">Pro</span>');
  if (/\bOEM\b/.test(g.name)) t.push('<span class="tag">OEM</span>');
  if (price && price.kind !== 'msrp' && isStale(price)) t.push(`<span class="tag warn" title="Price data is from ${esc(ago(price.fetched))}">Stale price</span>`);
  if (price && price.kind !== 'msrp' && price.listings != null && price.listings < MIN_LISTINGS) t.push('<span class="tag warn" title="Fewer than 3 matching listings">Few listings</span>');
  return t.join('');
}

const STAR_PATH = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z';
const DEAL_HINT = {
  great: "At least 10% below this card's 90-day average price, or its lowest price in 90 days",
  good: "At least 5% below this card's 90-day average price, or its lowest price in 30 days",
  high: "At least 8% above this card's 90-day average price",
};

function dealFor(g, price) {
  if (!price || price.kind === 'msrp' || !HISTORY) return null;
  return dealOf(seriesFor(HISTORY, g.id, price.kind, 90), price.price);
}

const dealTag = (deal) => (deal ? `<span class="deal ${deal.kind}" title="${esc(DEAL_HINT[deal.kind])}">${esc(deal.label)}</span>` : '');

function priceCell(price, g) {
  if (!price) return `<span class="na">${state.basis === 'msrp' ? 'No MSRP' : 'No live price'}</span>`;
  if (price.kind === 'msrp') return `<div class="p">${money(price.price)}</div><div class="s">launch MSRP</div>`;
  const count = price.listings != null ? ` · ${price.listings} listing${price.listings === 1 ? '' : 's'}` : '';
  return `<div class="p">${money(price.price)} ${dealTag(dealFor(g, price))}</div><div class="s" title="${esc(SOURCE_HINT[price.source] ?? '')}">${esc(SOURCE_SHORT[price.source] ?? price.source)}${count} · ${esc(ago(price.fetched))}</div>`;
}

const COMPARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="7" height="14" rx="1.5"/><rect x="13.5" y="5" width="7" height="14" rx="1.5"/></svg>';
const inCompare = (id) => state.cmp.some((c) => c.id === id);

function compareButton(g) {
  const on = inCompare(g.id);
  const label = `${on ? 'Remove from' : 'Add to'} comparison`;
  return `<button class="cmp-btn${on ? ' on' : ''}" type="button" data-cmp="${esc(g.id)}" aria-pressed="${on}" aria-label="${label}" title="${label}">${COMPARE_ICON}</button>`;
}

function starButton(g) {
  const on = WATCH.has(g.id);
  return `<button class="star${on ? ' on' : ''}" type="button" data-star="${esc(g.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} watchlist" title="${on ? 'Remove from' : 'Add to'} watchlist"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg></button>`;
}

function rowHtml(r, maxFps, maxValue) {
  const { g, perf, price, value } = r;
  const isOpen = open.has(g.id);
  const perfCell = perf
    ? `<div class="metric"><div class="top"><b>${perf.fps.toFixed(0)}</b><span>fps · ${perf.pct.toFixed(0)}%</span></div><div class="bar"><i style="width:${((perf.fps / maxFps) * 100).toFixed(1)}%"></i></div></div>`
    : '<span class="na">Not benchmarked</span>';
  const valueCell = value != null
    ? `<div class="metric"><div class="top"><b>${value.toFixed(1)}</b><span>fps/$100</span></div><div class="bar"><i style="width:${((value / maxValue) * 100).toFixed(1)}%"></i></div></div>`
    : '<span class="na">—</span>';
  return `<div class="row item${isOpen ? ' open' : ''}" role="row" data-id="${esc(g.id)}" tabindex="0" aria-expanded="${isOpen}">
  <div class="c-rank" role="cell">${r.rank ?? ''}</div>
  <div class="c-gpu" role="cell"><div class="n">${starButton(g)}${compareButton(g)}<i class="dot ${vendorKey(g).toLowerCase()}"></i>${esc(g.name)} ${tags(g, price)}${ALERTS.some((a) => a.card === g.id) ? '<span class="tag alert-tag" title="You have a price alert on this card">Alert</span>' : ''}</div><div class="s">${esc(gpuSubtitle(g))}</div></div>
  <div class="c-vram" role="cell">${g.memorySize ? `<b>${g.memorySize} GB</b><div class="s">${esc(g.memoryType ?? '')}</div>` : '<span class="na">—</span>'}</div>
  <div class="c-perf" role="cell">${perfCell}</div>
  <div class="c-price" role="cell">${priceCell(price, g)}</div>
  <div class="c-value" role="cell">${valueCell}</div>
  <div class="c-tdp" role="cell">${g.tdp ? `${g.tdp} W` : '—'}</div>
  <div class="c-chev" role="cell">${CHEVRON}</div>
</div>${isOpen ? detailHtml(r) : ''}`;
}

const MHZ = (v) => `${count(v)} MHz`;
const SPEC_GROUPS = [
  ['Chip', [
    ['gpuName', 'GPU chip'], ['architecture', 'Architecture'], ['generation', 'Generation'], ['releaseDate', 'Release date', fmtDate],
    ['processSize', 'Process', (v) => `${v} nm`], ['foundry', 'Foundry'], ['transistors', 'Transistors', (v) => `${v} billion`], ['dieSize', 'Die size', (v) => `${v} mm²`],
  ]],
  ['Memory', [
    ['memorySize', 'Size', (v, g) => `${v} GB ${g.memoryType ?? ''}`], ['memoryBus', 'Bus width', (v) => `${v}-bit`],
    ['memoryBandwidth', 'Bandwidth', (v) => `${v} GB/s`], ['memoryClock', 'Clock', MHZ], ['l2Cache', 'L2 cache', (v) => `${v} MB`],
  ]],
  ['Compute', [
    ['shaders', 'Shading units', count], ['computeUnits', 'Compute units', count], ['sms', 'SMs', count], ['executionUnits', 'Execution units', count],
    ['tmus', 'TMUs', count], ['rops', 'ROPs', count], ['rtCores', 'RT cores', count], ['tensorCores', 'Tensor cores', count],
    ['baseClock', 'Base clock', MHZ], ['boostClock', 'Boost clock', MHZ], ['fp32', 'FP32', (v) => `${v} TFLOPS`],
  ]],
  ['Board & power', [
    ['tdp', 'Board power', (v) => `${v} W`], ['suggestedPSU', 'Suggested PSU', (v) => `${v} W`], ['powerConnectors', 'Power connectors'],
    ['slot', 'Slot width'], ['length', 'Length', (v) => `${v} mm`], ['busInterface', 'Interface'],
  ]],
  ['Outputs & APIs', [
    ['displayOutputs', 'Outputs'], ['directX', 'DirectX'], ['vulkan', 'Vulkan'], ['openGL', 'OpenGL'], ['shaderModel', 'Shader model'],
  ]],
];

const has = (v) => v != null && v !== '';

function glance(g) {
  const cores = g.shaders ? [g.shaders.toLocaleString(), 'Shading units'] : g.computeUnits ? [g.computeUnits, 'Compute units'] : null;
  const tiles = [
    g.memorySize && [`${g.memorySize} GB ${g.memoryType ?? ''}`, 'Memory'],
    g.memoryBandwidth && [`${Math.round(g.memoryBandwidth)} GB/s`, 'Bandwidth'],
    g.boostClock && [`${(g.boostClock / 1000).toFixed(2)} GHz`, 'Boost clock'],
    cores,
    g.tdp && [`${g.tdp} W`, 'Board power'],
    g.releaseDate && [new Date(`${g.releaseDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), 'Released'],
  ].filter(Boolean);
  return `<div class="glance">${tiles.map(([v, k]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
}

function techChips(g) {
  const items = FEATURES.filter((f) => g.tech?.[f.id]);
  if (!items.length) return '';
  return `<h4>Technologies</h4><div class="tech-chips">${items
    .map((f) => `<span class="tech-chip" title="${esc(`${f.label}: ${f.hint}`)}">${esc(g.tech[f.id])}</span>`)
    .join('')}</div>`;
}

function fullSpecs(g) {
  const groups = SPEC_GROUPS.map(([title, fields]) => {
    const rows = fields.filter(([k]) => has(g[k])).map(([k, label, f]) => `<div><dt>${label}</dt><dd>${esc(f ? f(g[k], g) : g[k])}</dd></div>`);
    return rows.length ? `<div class="spec-group"><h5>${title}</h5><dl>${rows.join('')}</dl></div>` : '';
  }).join('');
  return `<details class="disclosure"><summary>Full specifications</summary><div class="spec-groups">${groups}</div></details>`;
}

// Per-game results live in full reviews. Search links (rather than guessed
// review URLs) always land on the right card.
function reviewLinks(g) {
  const name = (g.benchmarkName ?? g.name).replace(/^Intel /, '');
  const google = (site) => `https://www.google.com/search?q=${encodeURIComponent(`"${name}" review site:${site}`)}`;
  const links = [
    ['TechPowerUp', google('techpowerup.com/review')],
    ["Tom's Hardware", google('tomshardware.com')],
    ['TechSpot', google('techspot.com/review')],
    ['Hardware Unboxed', `https://www.youtube.com/results?search_query=${encodeURIComponent(`Hardware Unboxed ${name} review`)}`],
  ];
  return `<div class="review-links"><span>Per-game results in full reviews:</span>${links
    .map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${label} ↗</a>`)
    .join('')}</div>`;
}

function benchTable(g) {
  if (!g.perf) return '<p class="note">Not in Tom\'s Hardware\'s benchmark hierarchy, so this card has no performance or value score.</p>';
  const cell = (kind, res) => {
    const c = g.perf[kind]?.[res];
    const sel = res === state.res && (state.work === kind || state.work === 'mixed') ? ' class="sel"' : '';
    return `<td${sel}${c ? ` title="${c.pct.toFixed(1)}% of the fastest card"` : ''}>${c ? c.fps.toFixed(0) : '—'}</td>`;
  };
  return `<table class="bench"><thead><tr><th></th><th>1080p</th><th>1440p</th><th>4K</th></tr></thead><tbody>
<tr><td>Raster</td>${cell('raster', '1080p')}${cell('raster', '1440p')}${cell('raster', '4k')}</tr>
<tr><td>Ray tracing</td>${cell('rt', '1080p')}${cell('rt', '1440p')}${cell('rt', '4k')}</tr></tbody></table>
<p class="note">Average FPS at ultra settings across Tom's Hardware's game suite. Hover over a number for its percentage of the fastest card.</p>`;
}

function priceTiles(g) {
  const c = PRICES.cards?.[g.id] ?? {};
  const tile = (label, p) => {
    if (!p) return `<div class="price-tile"><span>${label}</span><b class="na">—</b><small>No reliable price right now</small></div>`;
    const count = p.listings != null ? ` · ${p.listings} listing${p.listings === 1 ? '' : 's'}` : '';
    return `<div class="price-tile"><span>${label}</span><b>${money(p.price)}</b><small title="${esc(SOURCE_HINT[p.source] ?? '')}">${esc(SOURCE_SHORT[p.source] ?? p.source)}${count} · ${esc(ago(p.fetched))}</small></div>`;
  };
  const msrp = g.msrp ? `<div class="price-tile"><span>Launch MSRP</span><b>${money(g.msrp)}</b><small>At release</small></div>` : '';
  return `<div class="price-tiles">${tile('New', c.new)}${tile('Used', c.used)}${msrp}</div>`;
}

function priceSources(g) {
  const c = PRICES.cards?.[g.id] ?? {};
  const q = c.quotes ?? {};
  const quote = (x) => {
    if (!x) return '<span class="na">—</span>';
    if (x.price == null) return x.outOfStock ? '<span class="na">Out of stock</span>' : '<span class="na">—</span>';
    return `${money(x.price)}${x.listings != null ? ` <span class="na">(${x.listings})</span>` : ''}`;
  };
  const when = (...xs) => {
    const f = xs.find((x) => x?.fetched)?.fetched;
    return f ? esc(fmtDate(f)) : '<span class="na">—</span>';
  };
  const ebayOff = PRICES.sources?.ebay?.status === 'unconfigured';
  const listings = [...(c.new?.examples ?? []).map((e) => ['New', e]), ...(c.used?.examples ?? []).map((e) => ['Used', e])];
  return `<details class="disclosure"><summary>Price sources &amp; listings</summary>
<table class="bench quotes"><thead><tr><th>Source</th><th>New</th><th>Used</th><th>Data from</th></tr></thead><tbody>
<tr><td title="${esc(SOURCE_HINT.retail)}">Retail tracker</td><td>${quote(q.retail)}</td><td><span class="na">—</span></td><td>${when(q.retail)}</td></tr>
<tr><td title="${esc(SOURCE_HINT.ebay)}">eBay live</td>${ebayOff ? '<td colspan="3"><span class="na">Not connected yet</span></td>' : `<td>${quote(q.ebayNew)}</td><td>${quote(q.ebayUsed)}</td><td>${when(q.ebayNew, q.ebayUsed)}</td>`}</tr>
<tr><td title="${esc(SOURCE_HINT.hardwaredeals)}">eBay snapshot</td><td>${quote(q.hdNew)}</td><td>${quote(q.hdUsed)}</td><td>${when(q.hdNew, q.hdUsed)}</td></tr>
</tbody></table>
<p class="note">Listing counts in parentheses. eBay prices need 3+ exact-model matches to be used.${q.retail?.lowestEver ? ` Lowest retail price ever: ${money(q.retail.lowestEver)}.` : ''}</p>
${listings.length ? `<h5>Cheapest matching listings</h5><ul class="listings">${listings.map(([kind, e]) => `<li><span class="tag">${kind}</span><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a><b>${money(e.price)}</b></li>`).join('')}</ul>` : ''}
</details>`;
}

function priceHistory(g) {
  if (!HISTORY) return '<p class="note">Price history isn\'t available right now.</p>';
  const series = { new: seriesFor(HISTORY, g.id, 'new', 90), used: seriesFor(HISTORY, g.id, 'used', 90) };
  const chart = priceChartHtml([{ label: 'New', slot: 1, points: series.new }, { label: 'Used', slot: 2, points: series.used }], money);
  if (!chart) return '<p class="note">Not enough price history for this card yet. It builds up from each day\'s prices.</p>';
  const line = (label, pts) => {
    const st = stats(pts);
    return st ? `<span><b>${label}</b> ${money(st.min)}–${money(st.max)}, avg ${money(Math.round(st.avg))}</span>` : '';
  };
  return `${chart}<p class="note range">Last 90 days: ${[line('New', series.new), line('Used', series.used)].filter(Boolean).join(' · ')}</p>`;
}

function alertSection(g) {
  const mine = ALERTS.filter((a) => a.card === g.id);
  const current = PRICES.cards?.[g.id]?.new?.price;
  const suggested = current ? Math.max(10, Math.floor((current * 0.9) / 10) * 10) : '';
  const list = mine.length
    ? `<ul class="alerts">${mine
        .map((a) => `<li><span>${a.condition === 'new' ? 'New' : 'Used'} at or below <b>${money(a.target)}</b></span>${a.below ? '<span class="deal good">Target reached</span>' : '<span class="na">Watching</span>'}<a href="${esc(a.url)}" target="_blank" rel="noopener">#${a.number} ↗</a></li>`)
        .join('')}</ul>`
    : '';
  return `${list}<form class="alert-form" data-card="${esc(g.id)}" data-name="${esc(g.name)}">
<label class="field">When
<select name="condition"><option value="new">New</option><option value="used">Used</option></select></label>
<label class="field">is at or below
<span class="money-input"><span>$</span><input name="target" type="number" min="1" step="1" required value="${suggested}" inputmode="numeric"></span></label>
<button type="submit">Create alert</button>
</form>
<p class="note">Opens a pre-filled GitHub issue. Submit it and you'll get an email when the price reaches your target. Close the issue to stop the alert.</p>`;
}

function detailHtml(r) {
  const { g } = r;
  const ebayQ = encodeURIComponent(g.benchmarkName ?? g.name);
  return `<div class="detail" role="row"><div class="d-col" role="cell">
<section>${glance(g)}</section>
${techChips(g) ? `<section>${techChips(g)}</section>` : ''}
${fullSpecs(g)}
<div class="links"><button type="button" class="btn small" data-cmp="${esc(g.id)}">${COMPARE_ICON}${inCompare(g.id) ? 'Remove from compare' : 'Add to compare'}</button>${g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener">TechPowerUp specs ↗</a>` : ''}<a href="https://www.ebay.com/sch/27386/i.html?_nkw=${ebayQ}&LH_BIN=1" target="_blank" rel="noopener">Search eBay ↗</a></div>
</div><div class="d-col" role="cell">
<section><h4>Game benchmarks</h4>${benchTable(g)}${reviewLinks(g)}</section>
${g.perf ? `<section><h4>Prices</h4>${priceTiles(g)}</section><section><h4>Price history</h4>${priceHistory(g)}</section><section><h4>Price alert</h4>${alertSection(g)}</section>${priceSources(g)}` : ''}
</div></div>`;
}

/** Deal for every priced card at the current price basis: Map(id -> deal). */
function currentDeals() {
  const deals = new Map();
  if (state.basis === 'msrp' || !HISTORY) return deals;
  for (const id of Object.keys(PRICES.cards ?? {})) {
    const g = DATA.gpus.find((x) => x.id === id);
    const deal = g && dealFor(g, priceOf(g, PRICES, state.basis));
    if (isDeal(deal)) deals.set(id, deal);
  }
  return deals;
}

function renderDeals(rows, deals) {
  const el = $('#deals');
  const basis = BASIS_LABEL[state.basis];
  const found = rows
    .filter((r) => deals.has(r.g.id))
    .map((r) => ({ ...r, deal: deals.get(r.g.id) }))
    .sort((a, b) => (a.deal.kind === b.deal.kind ? a.deal.pct - b.deal.pct : a.deal.kind === 'great' ? -1 : 1));
  const head = (extra = '') => `<div class="deals-head"><h2>Deals right now</h2><span class="note">${state.basis === 'msrp' ? '' : `${basis[0].toUpperCase() + basis.slice(1)} prices that are unusually low for that card, compared with its own last 90 days.`}</span>${extra}</div>`;

  if (state.basis === 'msrp') {
    el.innerHTML = `${head()}<p class="note deals-empty">Switch the price basis to New or Used to see deals. Launch MSRPs don't change.</p>`;
    return;
  }
  if (!found.length) {
    const anyDeals = deals.size > 0;
    el.innerHTML = `${head()}<p class="note deals-empty">${anyDeals
      ? 'No deals match your current filters.'
      : `No unusual deals on ${basis} prices right now. Most cards are at or above their 90-day average.`}</p>`;
    return;
  }
  const more = found.length > 6 ? `<button type="button" class="btn small" data-deals-all>Show all ${found.length}</button>` : '';
  el.innerHTML = `${head(more)}<div class="deal-list">${found
    .slice(0, 6)
    .map((r) => `<button type="button" class="deal-item ${r.deal.kind}" data-id="${esc(r.g.id)}">
<span class="deal-name"><i class="dot ${vendorKey(r.g).toLowerCase()}"></i>${esc(r.g.name)}</span>
<span class="deal-price"><b>${money(r.price.price)}</b><span class="deal ${r.deal.kind}" title="${esc(DEAL_HINT[r.deal.kind])}">${esc(r.deal.label)}</span></span>
<span class="deal-meta">90-day avg ${money(Math.round(r.deal.avg))}${r.value != null ? ` · ${r.value.toFixed(1)} fps/$100 · #${r.rank} value` : ''}</span>
</button>`)
    .join('')}</div>`;
}

function renderPicks(ranked) {
  const el = $('#picks');
  const top = ranked.slice(0, 3);
  if (!top.length) { el.innerHTML = ''; return; }
  const labels = ['Best value', 'Runner-up', 'Third'];
  el.innerHTML = top.map((r, i) => `<button class="pick" data-id="${esc(r.g.id)}">
<div class="label">${labels[i]} · ${RES_LABEL[state.res]} ${WORK_LABEL[state.work]}</div>
<div class="name"><i class="dot ${vendorKey(r.g).toLowerCase()}"></i> ${esc(r.g.name)}</div>
<div class="stats"><div class="v"><b>${r.value.toFixed(1)}</b>fps/$100</div><div><b>${r.perf.fps.toFixed(0)}</b>avg fps</div><div><b>${money(r.price.price)}</b>${BASIS_LABEL[state.basis]}</div><div><b>${r.g.memorySize} GB</b>VRAM</div></div>
</button>`).join('');
}

function renderSources() {
  const s = DATA.sources;
  const src = PRICES.sources ?? {};
  const parts = [];
  if (src.retail?.updated) parts.push(`retail <b>${esc(fmtDate(src.retail.updated))}</b>`);
  if (src.ebay?.status === 'live' || src.ebay?.status === 'partial') parts.push(`eBay <b>${esc(ago(src.ebay.updated))}</b>`);
  if (src.hardwaredeals?.updated) parts.push(`eBay snapshot <b>${esc(fmtDate(src.hardwaredeals.updated))}</b>`);
  const anyFresh = Object.entries(src).some(([k, v]) => v.updated && hoursOld(v.updated) <= (v.staleAfterHours ?? DEFAULT_STALE_HOURS));
  const pricePill = parts.length
    ? `<span class="pill"><i class="live${anyFresh ? '' : ' off'}"></i>Prices · ${parts.join(' · ')}</span>`
    : '<span class="pill"><i class="live off"></i>Live prices <b>not connected</b></span>';
  $('#sources').innerHTML = `${pricePill}
<span class="pill">Benchmarks <b>${esc(fmtDate(s.benchmarks?.updated))}</b> · Tom's Hardware</span>
<span class="pill">Specs <b>${DATA.gpus.length.toLocaleString()} GPUs</b> · TechPowerUp DB</span>`;
  $('#built').textContent = `Site built ${new Date(DATA.built).toLocaleString()}`;

  if (!parts.length) {
    showBanner('no-prices', 'Prices haven’t been fetched yet, so value is calculated from launch MSRP for now.');
  } else if (!anyFresh) {
    showBanner(`stale-${PRICES.updated}`, `Prices were last refreshed ${ago(PRICES.updated)}. The scheduled update may be failing.`);
  } else if (src.ebay?.status === 'unconfigured') {
    showBanner('ebay-unconfigured', 'New prices come from Tom’s Hardware’s US retail price tracker and used prices from a daily snapshot of eBay listings. Live eBay data will be added once its API is connected. Hover over a price to see its source.', 'info');
  } else showBanner(null);
}

// --- Banner and theme (choices remembered per browser) ---------------------------
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode etc. */ } },
};

/** Show a message unless the visitor dismissed this one (by key) before. */
function showBanner(key, text, kind = 'warn') {
  const banner = $('#banner');
  banner.hidden = !key || store.get('dismissedBanner') === key;
  if (banner.hidden) return;
  banner.dataset.key = key;
  banner.classList.toggle('info', kind === 'info');
  $('#bannerText').textContent = text;
}

const prefersDark = () => globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
const currentTheme = () => document.documentElement?.dataset.theme ?? (prefersDark() ? 'dark' : 'light');

function syncThemeToggle() {
  $('#themeToggle').setAttribute('aria-checked', String(currentTheme() === 'dark'));
}

function bindChrome() {
  $('#bannerClose').addEventListener('click', () => {
    store.set('dismissedBanner', $('#banner').dataset.key);
    $('#banner').hidden = true;
  });
  $('#themeToggle').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
    syncThemeToggle();
  });
  // Follow the OS setting live until the visitor picks a theme.
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!store.get('theme')) syncThemeToggle();
  });
  syncThemeToggle();
}

function render() {
  const deals = currentDeals();
  const { rows, ranked } = deriveRows(DATA.gpus, PRICES, { ...state, watchlist: [...WATCH], dealIds: new Set(deals.keys()) });
  const dealRows = rows.filter((r) => deals.has(r.g.id)).length;
  $('#dealsOnly').setAttribute('aria-pressed', String(state.dealsOnly));
  $('#dealCount').hidden = dealRows === 0;
  $('#dealCount').textContent = String(dealRows);
  $('#watchOnly').setAttribute('aria-pressed', String(state.watchOnly));
  $('#watchCount').hidden = WATCH.size === 0;
  $('#watchCount').textContent = String(WATCH.size);
  const maxFps = Math.max(1, ...rows.map((r) => r.perf?.fps ?? 0));
  const maxValue = Math.max(1e-9, ...rows.map((r) => r.value ?? 0));
  const shown = rows.slice(0, limit);

  $('#rows').innerHTML = shown.length
    ? shown.map((r) => rowHtml(r, maxFps, maxValue)).join('')
    : `<div class="empty">${state.minFps
      ? `No GPU averages ${state.minFps}+ fps at ${RES_LABEL[state.res]} ${WORK_LABEL[state.work]} with these filters. These are ultra-settings averages across a demanding game suite, so try a lower target, a lower resolution, or turn off other filters.`
      : 'No GPUs match these filters.'}</div>`;
  $('#more').hidden = rows.length <= limit;
  $('#more').textContent = `Show more (${(rows.length - limit).toLocaleString()} left)`;
  $('#summary').textContent = `${rows.length.toLocaleString()} GPU${rows.length === 1 ? '' : 's'}${state.minFps ? ` averaging ${state.minFps}+ fps` : ''} · ${ranked.length} with a value score at ${RES_LABEL[state.res]} ${WORK_LABEL[state.work]} using ${BASIS_LABEL[state.basis]} prices`;
  renderDeals(rows, deals);
  renderPicks(ranked);

  document.querySelectorAll('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(state[seg.dataset.key] === b.dataset.v))));
  document.querySelectorAll('#vendors button').forEach((b) => b.setAttribute('aria-pressed', String(state.vendors.includes(b.dataset.v))));
  const dir = state.dir ?? SORT_DIR[state.sort];
  document.querySelectorAll('.row.head button').forEach((b) => {
    b.classList.toggle('active', b.dataset.sort === state.sort);
    b.classList.toggle('asc', dir === 'asc');
  });
  $('#sort').value = state.sort;
  renderTray();
  renderCompare();
  writeUrl();
}

// --- Compare ---------------------------------------------------------------------
const shortName = (name) => name.replace(/^(GeForce|Radeon) /, '');
const byId = (id) => DATA.gpus.find((g) => g.id === id);
let noteTimer;

function flashNote(text) {
  $('#cmpNote').textContent = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => ($('#cmpNote').textContent = ''), 4000);
}

function setCompare(list) {
  state = { ...state, cmp: list, cmpView: state.cmpView && list.length >= 2 };
  if (!state.cmpView) closeDialog();
  render();
}

function toggleCompare(id) {
  if (inCompare(id)) return setCompare(removeFromCompare(state.cmp, id));
  if (state.cmp.length >= MAX_COMPARE) return flashNote(`You can compare up to ${MAX_COMPARE} cards. Remove one first.`);
  setCompare(addToCompare(state.cmp, id));
}

function renderTray() {
  const n = state.cmp.length;
  $('#cmpTray').hidden = n === 0;
  document.body?.classList.toggle('has-tray', n > 0);
  if (!n) return;
  $('#cmpChips').innerHTML = state.cmp
    .map((c) => {
      const name = shortName(byId(c.id)?.name ?? c.id);
      return `<span class="cmp-chip"><i class="key s-${c.slot}"></i>${esc(name)}<button type="button" data-cmp-remove="${esc(c.id)}" aria-label="Remove ${esc(name)} from comparison" title="Remove">×</button></span>`;
    })
    .join('');
  $('#cmpOpen').disabled = n < 2;
  $('#cmpOpen').textContent = n < 2 ? 'Add one more to compare' : `Compare ${n}`;
}

function compareCell(row, i) {
  const text = row.display[i];
  if (row.tech) {
    return text === '—'
      ? '<td class="no"><span class="na">—</span></td>'
      : `<td class="yes"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>${esc(text.replace(/^✓ /, ''))}</td>`;
  }
  const best = row.best.includes(i);
  return `<td class="${best ? 'best' : ''}${text === '—' ? ' na' : ''}">${esc(text)}${best ? '<span class="sr-only"> (best)</span>' : ''}</td>`;
}

function renderCompare() {
  if (!state.cmpView) return;
  const cards = state.cmp.map((c) => ({ ...c, g: byId(c.id) })).filter((c) => c.g);
  const rows = buildComparison(cards.map((c) => c.g), { prices: PRICES, state, money, dealLabel: (g, p) => dealFor(g, p)?.label ?? '' });
  const cols = cards.length + 1;
  const head = `<tr><th class="corner" scope="col"><span class="sr-only">Spec</span></th>${cards
    .map((c) => `<th scope="col"><div class="cmp-card"><i class="key s-${c.slot}"></i><div><b>${esc(c.g.name)}</b><span>${esc(gpuSubtitle(c.g))}</span></div><button type="button" class="cmp-remove" data-cmp-remove="${esc(c.id)}" aria-label="Remove ${esc(c.g.name)} from comparison" title="Remove">×</button></div></th>`)
    .join('')}</tr>`;

  const chart = priceChartHtml(cards.map((c) => ({ label: shortName(c.g.name), slot: c.slot, points: seriesFor(HISTORY, c.g.id, 'new', 90) })), money, { caption: 'New price history' });
  let body = '';
  let group = null;
  for (const row of rows) {
    if (state.cmpDiff && !row.differs) continue;
    if (row.group !== group) {
      if (group === 'Value & price') body += chartRows();
      group = row.group;
      body += `<tr class="grp"><th colspan="${cols}" scope="colgroup">${esc(group)}</th></tr>`;
    }
    const label = `${esc(row.label)}${row.current ? ' <span class="tag">Your setting</span>' : ''}`;
    body += `<tr${row.current ? ' class="current"' : ''}><th scope="row"${row.hint ? ` title="${esc(row.hint)}"` : ''}>${label}</th>${row.display.map((_, i) => compareCell(row, i)).join('')}</tr>`;
  }
  if (group === 'Value & price') body += chartRows();
  function chartRows() {
    return `<tr class="grp"><th colspan="${cols}" scope="colgroup">New price, last 90 days</th></tr><tr class="chart-row"><td colspan="${cols}">${chart || '<p class="note">Not enough price history for these cards yet.</p>'}</td></tr>`;
  }

  $('#cmpDiff').checked = state.cmpDiff;
  $('#cmpBody').innerHTML = `<p class="note cmp-sub">Using ${RES_LABEL[state.res]} ${WORK_LABEL[state.work]} performance and ${BASIS_LABEL[state.basis]} prices. The best value in each comparable row is highlighted.</p>
<div class="cmp-scroll"><table class="cmp-table" style="--cols:${cards.length}"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${cols}" class="note">These cards are identical in every row.</td></tr>`}</tbody></table></div>`;
}

function openDialog() {
  const d = $('#cmpDialog');
  if (!d.open) d.showModal?.();
}
function closeDialog() {
  const d = $('#cmpDialog');
  if (d.open) d.close?.();
}

function openCompare() {
  if (state.cmp.length < 2) return;
  state = { ...state, cmpView: true };
  openDialog();
  renderCompare();
  writeUrl();
}

function closeCompare() {
  if (!state.cmpView) return;
  state = { ...state, cmpView: false };
  closeDialog();
  writeUrl();
}

function bindCompare() {
  const removeOrToggle = (e) => {
    const rm = e.target.closest('[data-cmp-remove]');
    if (rm) setCompare(removeFromCompare(state.cmp, rm.dataset.cmpRemove));
  };
  $('#cmpChips').addEventListener('click', removeOrToggle);
  $('#cmpBody').addEventListener('click', removeOrToggle);
  $('#cmpClear').addEventListener('click', () => setCompare([]));
  $('#cmpOpen').addEventListener('click', openCompare);
  $('#cmpClose').addEventListener('click', closeCompare);
  $('#cmpDiff').addEventListener('change', (e) => { state = { ...state, cmpDiff: e.target.checked }; renderCompare(); writeUrl(); });
  const dialog = $('#cmpDialog');
  dialog.addEventListener('close', () => { if (state.cmpView) { state = { ...state, cmpView: false }; writeUrl(); } }); // Esc
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeCompare(); }); // backdrop
  bindPriceCharts($('#cmpBody'), money);
}

/** Open a card's details and scroll to it, showing more rows first if it's further down the list. */
function reveal(id) {
  const { rows } = deriveRows(DATA.gpus, PRICES, { ...state, watchlist: [...WATCH], dealIds: new Set(currentDeals().keys()) });
  const index = rows.findIndex((r) => r.g.id === id);
  if (index >= limit) limit = Math.ceil((index + 1) / PAGE) * PAGE;
  open.add(id);
  render();
  document.querySelector(`.row.item[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function update(patch) {
  state = { ...state, ...patch };
  limit = PAGE;
  render();
}

// --- Events --------------------------------------------------------------------
// --- Technologies dropdown --------------------------------------------------------
function renderTechMenu() {
  $('#techMenu').innerHTML = `${FEATURE_GROUPS.map((grp) => `<div class="dd-group"><div class="dd-title">${esc(grp.title)}</div>${grp.items
    .map((f) => `<label class="check"><input type="checkbox" value="${f.id}"${state.tech.includes(f.id) ? ' checked' : ''}><span class="box" aria-hidden="true"></span><span class="txt"><b>${esc(f.label)}</b><small>${esc(f.hint)}</small></span></label>`)
    .join('')}</div>`).join('')}
<div class="dd-foot"><span>Cards must support every selected technology.</span><button type="button" id="techClear">Clear</button></div>`;
}

function syncTechButton() {
  const n = state.tech.length;
  $('#techCount').hidden = n === 0;
  $('#techCount').textContent = String(n);
  $('#techBtn').classList.toggle('active', n > 0);
}

function bindTech() {
  const btn = $('#techBtn');
  const menu = $('#techMenu');
  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  renderTechMenu();
  syncTechButton();
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.id !== 'techClear') return;
    update({ tech: [] });
    renderTechMenu();
    syncTechButton();
  });
  menu.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    const id = e.target.value;
    update({ tech: e.target.checked ? [...state.tech, id] : state.tech.filter((x) => x !== id) });
    syncTechButton();
  });
  // Close on outside click or Escape.
  globalThis.addEventListener?.('click', () => setOpen(false));
  globalThis.addEventListener?.('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); }
  });
}

function bind() {
  bindTech();
  bindCompare();
  const q = $('#q');
  q.value = state.q;
  let t;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => update({ q: q.value.trim() }), 120); });

  document.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) update({ [seg.dataset.key]: b.dataset.v });
  }));
  $('#vendors').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = b.dataset.v;
    update({ vendors: state.vendors.includes(v) ? state.vendors.filter((x) => x !== v) : [...state.vendors, v] });
  });
  $('#minVram').value = String(state.minVram);
  $('#minVram').addEventListener('change', (e) => update({ minVram: Number(e.target.value) }));
  $('#maxPrice').value = state.maxPrice ?? '';
  $('#maxPrice').addEventListener('input', (e) => update({ maxPrice: Number(e.target.value) || null }));
  $('#minFps').value = state.minFps ?? '';
  $('#minFps').addEventListener('input', (e) => update({ minFps: Number(e.target.value) || null }));
  $('#segment').value = state.segment;
  $('#segment').addEventListener('change', (e) => update({ segment: e.target.value }));
  $('#sort').addEventListener('change', (e) => update({ sort: e.target.value, dir: null }));
  $('#rankedOnly').checked = state.rankedOnly;
  $('#rankedOnly').addEventListener('change', (e) => update({ rankedOnly: e.target.checked }));

  document.querySelector('.row.head').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sort]');
    if (!b) return;
    const key = b.dataset.sort;
    const cur = state.dir ?? SORT_DIR[state.sort];
    update(key === state.sort ? { dir: cur === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: null });
  });

  const toggle = (id) => {
    open.has(id) ? open.delete(id) : open.add(id);
    render();
  };
  $('#watchOnly').addEventListener('click', () => update({ watchOnly: !state.watchOnly }));
  $('#dealsOnly').addEventListener('click', () => update({ dealsOnly: !state.dealsOnly }));
  $('#deals').addEventListener('click', (e) => {
    if (e.target.closest('[data-deals-all]')) return update({ dealsOnly: true });
    const item = e.target.closest('.deal-item');
    if (item) reveal(item.dataset.id);
  });
  $('#rows').addEventListener('submit', (e) => {
    const form = e.target.closest('.alert-form');
    if (!form) return;
    e.preventDefault();
    const condition = form.elements.condition.value;
    const target = Math.round(Number(form.elements.target.value));
    if (!(target > 0)) return;
    const name = form.dataset.name;
    const params = new URLSearchParams({
      labels: 'price-watch',
      title: `Price alert: ${name} (${condition}) at or below $${target}`,
      body: `card: ${form.dataset.card}\ncondition: ${condition}\ntarget: ${target}\n\nCreated from GPU Value. You'll get a comment (and an email) when the price reaches the target. Close this issue to stop the alert.`,
    });
    globalThis.open?.(`https://github.com/${DATA.repo}/issues/new?${params}`, '_blank', 'noopener');
  });
  bindPriceCharts($('#rows'), money);
  $('#rows').addEventListener('click', (e) => {
    const cmp = e.target.closest('[data-cmp]');
    if (cmp) { toggleCompare(cmp.dataset.cmp); return; }
    const star = e.target.closest('.star');
    if (star) {
      const id = star.dataset.star;
      WATCH.has(id) ? WATCH.delete(id) : WATCH.add(id);
      store.set('watchlist', JSON.stringify([...WATCH]));
      render();
      return;
    }
    if (e.target.closest('a, .detail')) return;
    const row = e.target.closest('.row.item');
    if (row) toggle(row.dataset.id);
  });
  $('#rows').addEventListener('keydown', (e) => {
    if (e.target.closest('button, a, input, select, textarea')) return;
    const row = e.target.closest('.row.item');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(row.dataset.id); }
  });
  $('#picks').addEventListener('click', (e) => {
    const b = e.target.closest('.pick');
    if (b) reveal(b.dataset.id);
  });
  $('#more').addEventListener('click', () => { limit += PAGE * 2; render(); });
}

// --- Boot ----------------------------------------------------------------------
async function main() {
  const optional = (url) => fetch(url, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [gpus, prices, history, alerts] = await Promise.all([
    fetch('data/gpus.json').then((r) => r.json()),
    optional('data/prices.json'),
    optional('data/history.json'),
    optional('data/alerts.json'),
  ]);
  DATA = gpus;
  if (prices) PRICES = prices;
  HISTORY = history;
  ALERTS = Array.isArray(alerts) ? alerts : [];
  try { WATCH = new Set(JSON.parse(store.get('watchlist') ?? '[]')); } catch { WATCH = new Set(); }
  for (const g of DATA.gpus) g._search = searchText(g);

  state = readUrl();
  // With no live prices yet, fall back to MSRP so the ranking still works.
  const hasLive = Object.keys(PRICES.cards ?? {}).length > 0;
  if (!hasLive && !new URLSearchParams(location.search).has('basis')) state.basis = 'msrp';

  const repo = document.querySelector('meta[name="repo"]')?.content;
  if (repo) $('#repoLink').href = repo;

  bindChrome();
  renderSources();
  bind();
  render();
  if (state.cmpView) openCompare(); // shared link straight into a comparison
}

main().catch((err) => {
  $('#rows').innerHTML = `<div class="empty">Couldn't load GPU data: ${esc(err.message)}</div>`;
  console.error(err);
});
