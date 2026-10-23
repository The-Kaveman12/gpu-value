import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordDay, sliceHistory, valuesFromPrices } from '../scripts/lib/history.js';
import { dealOf, seriesFor, stats } from '../site/history.js';

test('recordDay appends, overwrites the same day, inserts backfilled days and skips empty days', () => {
  let h = recordDay(null, '2026-10-20', { a: { n: 500, u: 400 } });
  h = recordDay(h, '2026-10-22', { a: { n: 520 }, b: { n: 300 } });
  h = recordDay(h, '2026-10-22', { a: { n: 510 } }); // later run the same day wins
  h = recordDay(h, '2026-10-21', { a: { n: 505 } }); // out of order
  h = recordDay(h, '2026-10-23', {}); // nothing fresh: no new day
  assert.deepEqual(h.days, ['2026-10-20', '2026-10-21', '2026-10-22']);
  assert.deepEqual(h.cards.a.n, [500, 505, 510]);
  assert.deepEqual(h.cards.a.u, [400, null, null]);
  assert.deepEqual(h.cards.b.n, [null, null, 300]);
});

test('recordDay prunes days older than the keep window', () => {
  let h = null;
  for (let d = 1; d <= 9; d++) h = recordDay(h, `2026-10-0${d}`, { a: { n: d } }, 5);
  assert.deepEqual(h.days, ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(h.cards.a.n, [5, 6, 7, 8, 9]);
});

test('valuesFromPrices records only fresh quotes', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  const prices = {
    cards: {
      a: { new: { source: 'retail', price: 849, fetched: '2026-10-19T00:00:00Z' }, used: { source: 'hardwaredeals', price: 700, fetched: '2026-10-10T00:00:00Z' } },
      b: { new: { source: 'retail', price: 300, fetched: '2026-09-01T00:00:00Z' } },
    },
  };
  assert.deepEqual(valuesFromPrices(prices, now), { a: { n: 849, u: null } });
});

test('sliceHistory keeps the last N days and drops empty cards', () => {
  const h = { updated: 'x', days: ['d1', 'd2', 'd3'], cards: { a: { n: [1, 2, 3], u: [null, null, null] }, b: { n: [9, null, null], u: [null, null, null] } } };
  assert.deepEqual(sliceHistory(h, 2), { updated: 'x', days: ['d2', 'd3'], cards: { a: { n: [2, 3], u: [null, null] } } });
});

const daily = (prices, start = '2026-07-01') =>
  prices.map((price, i) => ({ day: new Date(Date.parse(`${start}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10), price }));

test('seriesFor returns non-null points inside the window', () => {
  const h = { days: ['2026-07-01', '2026-09-01', '2026-10-01'], cards: { a: { n: [100, null, 120], u: [null, null, null] } } };
  assert.deepEqual(seriesFor(h, 'a', 'new', 90).map((p) => p.price), [120]);
  assert.deepEqual(seriesFor(h, 'a', 'new', 120).map((p) => p.price), [100, 120]);
  assert.deepEqual(seriesFor(h, 'zzz', 'new'), []);
  assert.deepEqual(stats(daily([1, 2, 3])), { min: 1, max: 3, avg: 2, n: 3 });
});

test('dealOf: lows, below and above average, flat prices, thin history', () => {
  const rising = daily([...Array(60).fill(500), ...Array(30).fill(600)]);
  assert.equal(dealOf(rising, 600).kind, 'high'); // 600 vs avg 533 = +13%
  const falling = daily([...Array(60).fill(600), ...Array(30).fill(560)]);
  assert.equal(dealOf(falling, 540).kind, 'low'); // new 30-day low, 7% under average
  // Below average but above a recent dip to $500: "good", not a 30-day low.
  const dipped = daily([...Array(60).fill(600), ...Array(5).fill(500), ...Array(25).fill(580)]);
  assert.deepEqual(dealOf(dipped, 550), { kind: 'good', label: '7% below 90-day avg', pct: -7 });
  assert.equal(dealOf(daily(Array(90).fill(765)), 765), null); // flat for months: not a deal
  assert.equal(dealOf(daily([500, 500, 500]), 400), null); // too little history
  assert.equal(dealOf(rising, null), null);
});
