// GPU Value: client-side filtering, sorting and rendering.

import { derive as deriveRows, SORT_DIR, searchText, vendorKey } from './logic.js';

const PAGE = 50;
const STALE_PRICE_HOURS = 48;
const DEFAULTS = { q: '', res: '1440p', work: 'raster', basis: 'new', vendors: [], minVram: 0, maxPrice: null, segment: 'desktop', sort: 'value', dir: null, rankedOnly: false };
const RES_LABEL = { '1080p': '1080p', '1440p': '1440p', '4k': '4K' };
const WORK_LABEL = { raster: 'raster', rt: 'ray tracing', mixed: 'mixed' };
const BASIS_LABEL = { new: 'new', used: 'used', msrp: 'MSRP' };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => (n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })}`);
const fmtDate = (d) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown');
function ago(iso) {
  const h = (Date.now() - new Date(iso)) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
const hoursOld = (iso) => (Date.now() - new Date(iso)) / 36e5;

let DATA = { gpus: [], sources: {} };
let PRICES = { cards: {}, status: 'unavailable' };
let state = { ...DEFAULTS };
let limit = PAGE;
const open = new Set();

// --- URL state ---------------------------------------------------------------
function readUrl() {
  const p = new URLSearchParams(location.search);
  const s = { ...DEFAULTS };
  for (const k of ['q', 'res', 'work', 'basis', 'segment', 'sort', 'dir']) if (p.has(k)) s[k] = p.get(k);
  if (p.has('vendors')) s.vendors = p.get('vendors').split(',').filter(Boolean);
  if (p.has('minVram')) s.minVram = Number(p.get('minVram')) || 0;
  if (p.has('maxPrice')) s.maxPrice = Number(p.get('maxPrice')) || null;
  s.rankedOnly = p.get('ranked') === '1';
  return s;
}
function writeUrl() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (k === 'rankedOnly') { if (v) p.set('ranked', '1'); continue; }
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
  if (price && price.kind !== 'msrp' && price.fetched && hoursOld(price.fetched) > STALE_PRICE_HOURS) t.push(`<span class="tag warn" title="Price last refreshed ${esc(ago(price.fetched))}">Stale price</span>`);
  if (price && price.kind !== 'msrp' && price.listings < 3) t.push('<span class="tag warn" title="Fewer than 3 matching listings">Few listings</span>');
  return t.join('');
}

function priceCell(price) {
  if (!price) return `<span class="na">${state.basis === 'msrp' ? 'No MSRP' : 'No live price'}</span>`;
  if (price.kind === 'msrp') return `<div class="p">${money(price.price)}</div><div class="s">launch MSRP</div>`;
  return `<div class="p">${money(price.price)}</div><div class="s">${price.listings} listing${price.listings === 1 ? '' : 's'} · ${esc(ago(price.fetched))}</div>`;
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
  <div class="c-gpu" role="cell"><div class="n"><i class="dot ${vendorKey(g).toLowerCase()}"></i>${esc(g.name)} ${tags(g, price)}</div><div class="s">${esc(gpuSubtitle(g))}</div></div>
  <div class="c-vram" role="cell">${g.memorySize ? `<b>${g.memorySize} GB</b><div class="s">${esc(g.memoryType ?? '')}</div>` : '<span class="na">—</span>'}</div>
  <div class="c-perf" role="cell">${perfCell}</div>
  <div class="c-price" role="cell">${priceCell(price)}</div>
  <div class="c-value" role="cell">${valueCell}</div>
  <div class="c-tdp" role="cell">${g.tdp ? `${g.tdp} W` : '—'}</div>
  <div class="c-chev" role="cell">${CHEVRON}</div>
</div>${isOpen ? detailHtml(r) : ''}`;
}

const SPEC_FIELDS = [
  ['gpuName', 'GPU chip'], ['architecture', 'Architecture'], ['generation', 'Generation'], ['releaseDate', 'Release date', fmtDate],
  ['processSize', 'Process', (v) => `${v} nm`], ['foundry', 'Foundry'], ['transistors', 'Transistors', (v) => `${v} B`], ['dieSize', 'Die size', (v) => `${v} mm²`],
  ['memorySize', 'Memory', (v, g) => `${v} GB ${g.memoryType ?? ''}`], ['memoryBus', 'Memory bus', (v) => `${v}-bit`],
  ['memoryBandwidth', 'Bandwidth', (v) => `${v} GB/s`], ['memoryClock', 'Memory clock', (v) => `${v} MHz`],
  ['shaders', 'Shading units'], ['computeUnits', 'Compute units'], ['sms', 'SMs'], ['executionUnits', 'Execution units'],
  ['tmus', 'TMUs'], ['rops', 'ROPs'], ['rtCores', 'RT cores'], ['tensorCores', 'Tensor cores'],
  ['baseClock', 'Base clock', (v) => `${v} MHz`], ['boostClock', 'Boost clock', (v) => `${v} MHz`], ['l2Cache', 'L2 cache', (v) => `${v} MB`],
  ['fp32', 'FP32', (v) => `${v} TFLOPS`], ['tdp', 'Board power', (v) => `${v} W`], ['suggestedPSU', 'Suggested PSU', (v) => `${v} W`],
  ['powerConnectors', 'Power connectors'], ['slot', 'Slot width'], ['length', 'Length', (v) => `${v} mm`], ['busInterface', 'Interface'],
  ['displayOutputs', 'Outputs'], ['directX', 'DirectX'], ['vulkan', 'Vulkan'], ['openGL', 'OpenGL'], ['shaderModel', 'Shader model'],
];

function benchTable(g) {
  if (!g.perf) return '<p class="na">Tom\'s Hardware hasn\'t benchmarked this card in its current hierarchy, so it has no value score.</p>';
  const cell = (kind, res) => {
    const c = g.perf[kind]?.[res];
    const sel = res === state.res && (state.work === kind || state.work === 'mixed') ? ' class="sel"' : '';
    return `<td${sel}>${c ? `${c.fps.toFixed(1)} <span class="na">(${c.pct.toFixed(1)}%)</span>` : '—'}</td>`;
  };
  return `<table class="bench"><thead><tr><th>Avg FPS (% of fastest)</th><th>1080p</th><th>1440p</th><th>4K</th></tr></thead><tbody>
<tr><td>Raster</td>${cell('raster', '1080p')}${cell('raster', '1440p')}${cell('raster', '4k')}</tr>
<tr><td>Ray tracing</td>${cell('rt', '1080p')}${cell('rt', '1440p')}${cell('rt', '4k')}</tr></tbody></table>`;
}

function priceBox(g) {
  const box = (label, p) => {
    if (!p) return `<div><div class="k">${label}</div><div class="v na">—</div><div class="s">No matching listings</div></div>`;
    const ex = (p.examples ?? []).map((e) => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a><span>${money(e.price)}</span></li>`).join('');
    return `<div><div class="k">${label}</div><div class="v">${money(p.price)}</div>
<div class="s">Lowest ${money(p.low)} · ${p.listings} listing${p.listings === 1 ? '' : 's'} · ${esc(ago(p.fetched))}${p.carriedForward ? ' (last successful check)' : ''}</div>
${ex ? `<ul>${ex}</ul>` : ''}</div>`;
  };
  const c = PRICES.cards?.[g.id] ?? {};
  return `<div class="pricebox">${box('eBay new', c.new)}${box('eBay used', c.used)}</div>
<div class="s" style="margin-top:8px;color:var(--muted);font-size:12px">Launch MSRP: ${g.msrp ? money(g.msrp) : 'n/a'}</div>`;
}

function detailHtml(r) {
  const { g } = r;
  const specs = SPEC_FIELDS.filter(([k]) => g[k] != null && g[k] !== '')
    .map(([k, label, f]) => `<div><dt>${label}</dt><dd>${esc(f ? f(g[k], g) : g[k])}</dd></div>`)
    .join('');
  const ebayQ = encodeURIComponent(g.benchmarkName ?? g.name);
  return `<div class="detail" role="row"><div role="cell">
<h4>Specifications</h4><dl class="specs">${specs}</dl>
<div class="links">${g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener">TechPowerUp spec page ↗</a>` : ''}
<a href="https://www.ebay.com/sch/27386/i.html?_nkw=${ebayQ}&LH_BIN=1" target="_blank" rel="noopener">Search eBay ↗</a></div>
</div><div role="cell">
<h4>Game benchmarks</h4>${benchTable(g)}
${g.perf ? `<h4>Prices</h4>${priceBox(g)}` : ''}
</div></div>`;
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
  const live = PRICES.status === 'live' || PRICES.status === 'partial';
  const pricePill = PRICES.updated
    ? `<span class="pill"><i class="live${live && hoursOld(PRICES.updated) < STALE_PRICE_HOURS ? '' : ' off'}"></i>Prices <b>${esc(ago(PRICES.updated))}</b> · eBay</span>`
    : '<span class="pill"><i class="live off"></i>Live prices <b>not connected</b></span>';
  $('#sources').innerHTML = `${pricePill}
<span class="pill">Benchmarks <b>${esc(fmtDate(s.benchmarks?.updated))}</b> · Tom's Hardware</span>
<span class="pill">Specs <b>${DATA.gpus.length.toLocaleString()} GPUs</b> · TechPowerUp DB</span>`;
  $('#built').textContent = `Site built ${new Date(DATA.built).toLocaleString()}`;

  const banner = $('#banner');
  if (!PRICES.updated) {
    banner.hidden = false;
    banner.textContent = 'Live eBay prices haven’t been fetched yet, so value is calculated from launch MSRP for now.';
  } else if (hoursOld(PRICES.updated) > STALE_PRICE_HOURS) {
    banner.hidden = false;
    banner.textContent = `Prices were last refreshed ${ago(PRICES.updated)}. The scheduled update may be failing.`;
  } else banner.hidden = true;
}

function render() {
  const { rows, ranked } = deriveRows(DATA.gpus, PRICES, state);
  const maxFps = Math.max(1, ...rows.map((r) => r.perf?.fps ?? 0));
  const maxValue = Math.max(1e-9, ...rows.map((r) => r.value ?? 0));
  const shown = rows.slice(0, limit);

  $('#rows').innerHTML = shown.length
    ? shown.map((r) => rowHtml(r, maxFps, maxValue)).join('')
    : '<div class="empty">No GPUs match these filters.</div>';
  $('#more').hidden = rows.length <= limit;
  $('#more').textContent = `Show more (${(rows.length - limit).toLocaleString()} left)`;
  $('#summary').textContent = `${rows.length.toLocaleString()} GPU${rows.length === 1 ? '' : 's'} · ${ranked.length} with a value score at ${RES_LABEL[state.res]} ${WORK_LABEL[state.work]} using ${BASIS_LABEL[state.basis]} prices`;
  renderPicks(ranked);

  document.querySelectorAll('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(state[seg.dataset.key] === b.dataset.v))));
  document.querySelectorAll('#vendors button').forEach((b) => b.setAttribute('aria-pressed', String(state.vendors.includes(b.dataset.v))));
  const dir = state.dir ?? SORT_DIR[state.sort];
  document.querySelectorAll('.row.head button').forEach((b) => {
    b.classList.toggle('active', b.dataset.sort === state.sort);
    b.classList.toggle('asc', dir === 'asc');
  });
  $('#sort').value = state.sort;
  writeUrl();
}

function update(patch) {
  state = { ...state, ...patch };
  limit = PAGE;
  render();
}

// --- Events --------------------------------------------------------------------
function bind() {
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
  $('#rows').addEventListener('click', (e) => {
    if (e.target.closest('a, .detail')) return;
    const row = e.target.closest('.row.item');
    if (row) toggle(row.dataset.id);
  });
  $('#rows').addEventListener('keydown', (e) => {
    const row = e.target.closest('.row.item');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(row.dataset.id); }
  });
  $('#picks').addEventListener('click', (e) => {
    const b = e.target.closest('.pick');
    if (!b) return;
    open.add(b.dataset.id);
    render();
    document.querySelector(`.row.item[data-id="${CSS.escape(b.dataset.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('#more').addEventListener('click', () => { limit += PAGE * 2; render(); });
}

// --- Boot ----------------------------------------------------------------------
async function main() {
  const [gpus, prices] = await Promise.all([
    fetch('data/gpus.json').then((r) => r.json()),
    fetch('data/prices.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  DATA = gpus;
  if (prices) PRICES = prices;
  for (const g of DATA.gpus) g._search = searchText(g);

  state = readUrl();
  // With no live prices yet, fall back to MSRP so the ranking still works.
  const hasLive = Object.keys(PRICES.cards ?? {}).length > 0;
  if (!hasLive && !new URLSearchParams(location.search).has('basis')) state.basis = 'msrp';

  const repo = document.querySelector('meta[name="repo"]')?.content;
  if (repo) $('#repoLink').href = repo;

  renderSources();
  bind();
  render();
}

main().catch((err) => {
  $('#rows').innerHTML = `<div class="empty">Couldn't load GPU data: ${esc(err.message)}</div>`;
  console.error(err);
});
