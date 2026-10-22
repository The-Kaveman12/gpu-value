import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { derive, perfOf } from '../site/logic.js';

const catalog = JSON.parse(await readFile(new URL('../site/data/gpus.json', import.meta.url), 'utf8'));
const base = { q: '', res: '1440p', work: 'raster', basis: 'msrp', vendors: [], minVram: 0, maxPrice: null, segment: 'desktop', sort: 'value', dir: null, rankedOnly: false };

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
    setAttribute() {}, classList: { toggle() {}, add() {}, remove() {} }, querySelectorAll: () => [],
  });
  globalThis.document = {
    querySelector: (sel) => (sel.startsWith('meta') || sel.startsWith('.row.item[') ? null : elements.get(sel) ?? elements.set(sel, el(sel)).get(sel)),
    querySelectorAll: () => [],
  };
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
  assert.match(rows, /All price sources/);
  assert.match(rows, /Retail \(Tom's Hardware tracker\)/);
  assert.doesNotMatch(rows, /undefined|NaN/);
});
