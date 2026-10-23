import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { addToCompare, buildComparison, decodeCompare, encodeCompare, MAX_COMPARE, removeFromCompare } from '../site/compare.js';

const catalog = JSON.parse(await readFile(new URL('../site/data/gpus.json', import.meta.url), 'utf8'));
const card = (name) => catalog.gpus.find((g) => g.name === name);
const money = (n) => `$${n}`;
const state = { res: '1440p', work: 'raster', basis: 'msrp' };

test('add/remove keep each card on a stable color slot and cap at four', () => {
  let list = [];
  for (const id of ['a', 'b', 'c']) list = addToCompare(list, id);
  assert.deepEqual(list, [{ id: 'a', slot: 1 }, { id: 'b', slot: 2 }, { id: 'c', slot: 3 }]);
  list = removeFromCompare(list, 'a');
  assert.deepEqual(list, [{ id: 'b', slot: 2 }, { id: 'c', slot: 3 }]); // survivors keep their colors
  list = addToCompare(list, 'd');
  assert.deepEqual(list.find((c) => c.id === 'd'), { id: 'd', slot: 1 }); // lowest free slot
  list = addToCompare(list, 'e');
  assert.equal(list.length, MAX_COMPARE);
  assert.equal(addToCompare(list, 'f'), list); // full: unchanged
  assert.equal(addToCompare(list, 'b'), list); // already present: unchanged
});

test('URL encoding round-trips and drops unknown, duplicate or extra cards', () => {
  const known = new Set(['a', 'b', 'c', 'd', 'e']);
  const list = [{ id: 'b', slot: 2 }, { id: 'c', slot: 3 }];
  assert.equal(encodeCompare(list), 'b~2,c~3');
  assert.deepEqual(decodeCompare('b~2,c~3', known), list);
  assert.deepEqual(decodeCompare('zzz~1,b~2,b~3', known), [{ id: 'b', slot: 2 }]);
  assert.deepEqual(decodeCompare('a~9,b~2', known), [{ id: 'a', slot: 1 }, { id: 'b', slot: 2 }]); // bad slot reassigned
  assert.equal(decodeCompare('a,b,c,d,e', known).length, MAX_COMPARE);
  assert.deepEqual(decodeCompare(null, known), []);
});

test('comparison marks the best value only in rows where better is unambiguous', () => {
  const gpus = [card('Radeon RX 9070'), card('Radeon RX 9070 XT'), card('GeForce RTX 5070')];
  const rows = buildComparison(gpus, { prices: null, state, money });
  const row = (label) => rows.find((r) => r.label === label);

  assert.deepEqual(row('Raster 1440p').display, ['104', '117', '96']);
  assert.deepEqual(row('Raster 1440p').best, [1]); // highest fps
  assert.equal(row('Raster 1440p').current, true); // the page's current setting
  assert.equal(row('Raster 1080p').current, false);

  assert.deepEqual(row('Price (MSRP)').best, [0, 2]); // $549.99 tie, lower is better
  assert.deepEqual(row('Board power').best.map((i) => gpus[i].name), gpus.filter((g) => g.tdp === Math.min(...gpus.map((x) => x.tdp))).map((g) => g.name));
  assert.deepEqual(row('Boost clock').best, []); // not comparable across architectures
  assert.deepEqual(row('Memory').best, [0, 1]); // 16 GB beats 12 GB
  assert.equal(row('Architecture').differs, true);

  const fpsPer100 = row('FPS per $100');
  assert.equal(fpsPer100.values[0], (104 / 549.99) * 100);
  assert.deepEqual(fpsPer100.best, [1]); // 9070 XT: 116.5 / $599.99 = 19.4 beats 9070's 18.9
});

test('technology rows show the vendor name and flag differences', () => {
  const rows = buildComparison([card('Radeon RX 9070 XT'), card('GeForce RTX 5070')], { prices: null, state, money });
  const mfg = rows.find((r) => r.label === 'Multi-frame generation (3×+)');
  assert.deepEqual(mfg.display, ['—', '✓ DLSS Multi Frame Generation']);
  assert.equal(mfg.tech, true);
  assert.equal(mfg.differs, true);
  assert.equal(rows.find((r) => r.label === 'Hardware ray tracing').differs, false);
});

test('missing data shows a dash and never wins', () => {
  const rows = buildComparison([card('Radeon RX 9070 XT'), catalog.gpus.find((g) => !g.perf && g.segment === 'desktop')], { prices: null, state, money });
  const r = rows.find((x) => x.label === 'Raster 1440p');
  assert.equal(r.display[1], '—');
  assert.deepEqual(r.best, []); // only one real value: nothing to compare
});
