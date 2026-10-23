import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { derive, perfOf } from '../site/logic.js';

const catalog = JSON.parse(await readFile(new URL('../site/data/gpus.json', import.meta.url), 'utf8'));
const base = { q: '', res: '1440p', work: 'raster', basis: 'msrp', vendors: [], minVram: 0, maxPrice: null, minFps: null, segment: 'desktop', sort: 'value', dir: null, rankedOnly: false };

test('catalog has every benchmarked card and only desktop/workstation segments', () => {
  assert.ok(catalog.gpus.length > 1000);
  assert.equal(catalog.gpus.filter((g) => g.perf).length, 48);
  assert.deepEqual([...new Set(catalog.gpus.map((g) => g.segment))].sort(), ['desktop', 'workstation']);
  const rx9070xt = catalog.gpus.find((g) => g.name === 'Radeon RX 9070 XT');
  assert.equal(rx9070xt.perf.raster['1440p'].fps, 116.5);
  assert.equal(rx9070xt.msrp, 599.99);
  assert.equal(rx9070xt.memorySize, 16);
});

test('value ranking divides fps by price', () => {
  const { ranked } = derive(catalog.gpus, null, base);
  assert.equal(ranked.length, 48);
  for (const r of ranked) assert.ok(Math.abs(r.value - (r.perf.fps / r.g.msrp) * 100) < 1e-9);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].value >= ranked[i].value);
});

test('live prices replace MSRP and unpriced cards lose their score', () => {
  const id = catalog.gpus.find((g) => g.name === 'GeForce RTX 5070').id;
  const prices = { cards: { [id]: { new: { price: 500, listings: 9, fetched: new Date().toISOString() } } } };
  const { ranked } = derive(catalog.gpus, prices, { ...base, basis: 'new' });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].value, (96.4 / 500) * 100);
});

test('filters: search, vendor, VRAM, max price, ranked only', () => {
  const s = (patch) => derive(catalog.gpus, null, { ...base, ...patch }).rows;
  assert.ok(s({ q: '9070 xt' }).every((r) => r.g.name.includes('9070 XT')));
  assert.ok(s({ vendors: ['Intel'] }).every((r) => r.g.vendor === 'Intel'));
  assert.ok(s({ minVram: 16 }).every((r) => r.g.memorySize >= 16));
  assert.ok(s({ maxPrice: 400 }).every((r) => r.price.price <= 400));
  assert.equal(s({ rankedOnly: true }).length, 48);
  assert.ok(s({ segment: 'workstation' }).length > 100);
  const fast = s({ minFps: 100 });
  assert.ok(fast.length > 0 && fast.every((r) => r.perf.fps >= 100));
  assert.ok(s({ minFps: 100, res: '4k' }).length < fast.length); // same target is harder at 4K
  assert.ok(s({ minFps: 60, work: 'rt' }).every((r) => r.g.perf.rt['1440p'].fps >= 60));
});

test('mixed workload weights raster 70% and RT 30%', () => {
  const g = catalog.gpus.find((x) => x.name === 'GeForce RTX 5070');
  const m = perfOf(g, { res: '1440p', work: 'mixed' });
  assert.ok(Math.abs(m.fps - (0.7 * g.perf.raster['1440p'].fps + 0.3 * g.perf.rt['1440p'].fps)) < 1e-9);
});

test('page script renders against a stub DOM without errors', async () => {
  const elements = new Map();
  const el = () => ({
    innerHTML: '', textContent: '', value: '', checked: false, hidden: false, href: '', dataset: {},
    addEventListener() {}, setAttribute() {}, classList: { toggle() {}, add() {}, remove() {} }, querySelectorAll: () => [],
  });
  globalThis.document = {
    querySelector: (sel) => (sel.startsWith('meta') ? null : elements.get(sel) ?? elements.set(sel, el()).get(sel)),
    querySelectorAll: () => [],
  };
  globalThis.location = { search: '?res=4k&work=mixed', pathname: '/' };
  globalThis.history = { replaceState() {} };
  globalThis.fetch = async (url) => ({
    ok: !url.includes('prices'),
    json: async () => JSON.parse(await readFile(new URL(`../site/${url}`, import.meta.url), 'utf8')),
  });
  await import('../site/app.js');
  await new Promise((r) => setTimeout(r, 50));
  const rows = elements.get('#rows').innerHTML;
  assert.match(rows, /class="row item/);
  assert.doesNotMatch(rows, /Couldn't load/);
  assert.match(elements.get('#picks').innerHTML, /Best value/);
  assert.match(elements.get('#summary').textContent, /48 with a value score at 4K mixed using MSRP prices/);
  assert.equal(elements.get('#banner').hidden, false);
});

test('page renders live multi-source prices and an opened detail panel', async () => {
  const elements = new Map();
  const listeners = new Map();
  const el = (sel) => ({
    innerHTML: '', textContent: '', value: '', checked: false, hidden: false, href: '', dataset: {},
    addEventListener(type, fn) { listeners.set(`${sel}:${type}`, fn); },
    attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, classList: { toggle() {}, add() {}, remove() {} }, querySelectorAll: () => [],
  });
  globalThis.document = {
    querySelector: (sel) => (sel.startsWith('meta') || sel.startsWith('.row.item[') ? null : elements.get(sel) ?? elements.set(sel, el(sel)).get(sel)),
    querySelectorAll: () => [],
  };
  globalThis.document.documentElement = { dataset: {} };
  const saved = new Map();
  globalThis.localStorage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, String(v)) };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.CSS = { escape: (s) => s };
  globalThis.location = { search: '', pathname: '/' };
  globalThis.history = { replaceState() {} };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => JSON.parse(await readFile(new URL(`../site/${url}`, import.meta.url), 'utf8')),
  });
  await import('../site/app.js?with-prices');
  await new Promise((r) => setTimeout(r, 50));

  assert.match(elements.get('#summary').textContent, /using new prices/);
  assert.match(elements.get('#sources').innerHTML, /retail/);
  const picks = elements.get('#picks').innerHTML;
  const id = /data-id="([^"]+)"/.exec(picks)[1];
  listeners.get('#picks:click')({ target: { closest: () => ({ dataset: { id } }) } });
  const rows = elements.get('#rows').innerHTML;
  assert.match(rows, /class="glance"/); // key specs up front
  assert.match(rows, /class="tech-chips"/);
  assert.match(rows, /<details class="disclosure"><summary>Full specifications/);
  assert.match(rows, /<details class="disclosure"><summary>Price sources &amp; listings/);
  assert.match(rows, />Retail tracker</);
  assert.match(rows, /class="review-links"/);
  assert.match(rows, /site%3Atechpowerup.com%2Freview/);
  assert.match(rows, /class="price-tile"><span>New<\/span><b>\$/);
  assert.doesNotMatch(rows, /undefined|NaN/);

  // Theme toggle flips light <-> dark and remembers the choice.
  listeners.get('#themeToggle:click')();
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(saved.get('theme'), 'dark');
  assert.equal(elements.get('#themeToggle').attrs['aria-checked'], 'true');
  listeners.get('#themeToggle:click')();
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(elements.get('#themeToggle').attrs['aria-checked'], 'false');

  // Technologies dropdown: open, check an option, count badge, URL.
  elements.get('#techMenu').hidden = true; // as in index.html
  listeners.get('#techBtn:click')({ stopPropagation() {} });
  assert.equal(elements.get('#techMenu').hidden, false);
  assert.match(elements.get('#techMenu').innerHTML, /value="dlss5"/);
  listeners.get('#techMenu:change')({ target: { type: 'checkbox', value: 'dlss5', checked: true } });
  assert.equal(elements.get('#techCount').textContent, '1');
  assert.match(elements.get('#summary').textContent, /^10 GPUs/);
  listeners.get('#techMenu:click')({ stopPropagation() {}, target: { id: 'techClear' } });
  assert.equal(elements.get('#techCount').hidden, true);

  // Price history chart and alert form in the opened card.
  const opened = elements.get('#rows').innerHTML;
  assert.match(opened, /<h4>Price history<\/h4><div class="pchart"/);
  assert.match(opened, /<path class="line s-new" d="M/);
  assert.match(opened, /<table class="sr-only"><caption>Price history/);
  assert.match(opened, /Last 90 days: <span><b>New<\/b> \$/);
  assert.match(opened, /<form class="alert-form" data-card="[^"]+"/);

  // Creating an alert opens a pre-filled GitHub issue.
  let openedUrl = null;
  globalThis.open = (url) => { openedUrl = url; };
  const form = { dataset: { card: 'amd-radeon-rx-9070-xt', name: 'Radeon RX 9070 XT' }, elements: { condition: { value: 'new' }, target: { value: '700' } } };
  listeners.get('#rows:submit')({ target: { closest: () => form }, preventDefault() {} });
  const issue = new URL(openedUrl);
  assert.equal(issue.pathname, '/The-Kaveman12/gpu-value/issues/new');
  assert.equal(issue.searchParams.get('labels'), 'price-watch');
  assert.match(issue.searchParams.get('body'), /^card: amd-radeon-rx-9070-xt\ncondition: new\ntarget: 700\n/);

  // Starring a card adds it to the watchlist; the Watchlist filter shows only starred cards.
  const star = (cardId) => listeners.get('#rows:click')({ target: { closest: (s) => (s === '.star' ? { dataset: { star: cardId } } : null) } });
  star('amd-radeon-rx-9070-xt');
  assert.deepEqual(JSON.parse(saved.get('watchlist')), ['amd-radeon-rx-9070-xt']);
  assert.equal(elements.get('#watchCount').textContent, '1');
  listeners.get('#watchOnly:click')();
  assert.match(elements.get('#summary').textContent, /^1 GPU /);
  assert.match(elements.get('#rows').innerHTML, /class="star on"/);
  listeners.get('#watchOnly:click')();
  star('amd-radeon-rx-9070-xt');
  assert.deepEqual(JSON.parse(saved.get('watchlist')), []);

  // The info banner can be dismissed, and that's remembered.
  const banner = elements.get('#banner');
  assert.equal(banner.hidden, false);
  assert.match(elements.get('#bannerText').textContent, /Tom’s Hardware/);
  listeners.get('#bannerClose:click')();
  assert.equal(banner.hidden, true);
  assert.equal(saved.get('dismissedBanner'), 'ebay-unconfigured');
});
