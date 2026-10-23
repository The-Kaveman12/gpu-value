import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint, healthProblems, MIN_PRICED_CARDS } from '../scripts/lib/health.js';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 864e5).toISOString();
const cards = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`gpu-${i}`, { new: { price: 500 } }]));
const healthy = () => ({
  sources: {
    retail: { status: 'live', updated: daysAgo(3), staleAfterHours: 240 },
    ebay: { status: 'unconfigured', staleAfterHours: 48 },
    hardwaredeals: { status: 'live', updated: daysAgo(1), staleAfterHours: 72 },
  },
  cards: cards(34),
  errors: [],
});

test('a healthy price file has no problems (an unconfigured eBay API is expected)', () => {
  assert.deepEqual(healthProblems(healthy(), NOW), []);
});

test('stale sources, missing data and low coverage are problems', () => {
  const doc = healthy();
  doc.sources.retail = { status: 'failed', updated: daysAgo(12), staleAfterHours: 240 };
  doc.sources.hardwaredeals = { status: 'failed', staleAfterHours: 72 };
  doc.cards = cards(MIN_PRICED_CARDS - 1);
  const p = healthProblems(doc, NOW);
  assert.equal(p.length, 3);
  assert.match(p[0], /retail tracker: data is 12 days old \(limit 10 days, status: failed\)/);
  assert.match(p[1], /HardwareDeals.*no successful update/);
  assert.match(p[2], /Only 19 cards/);
  assert.match(healthProblems(null, NOW)[0], /missing/);
});

test('a single failed run is not a problem while the carried-forward data is fresh', () => {
  const doc = healthy();
  doc.sources.retail.status = 'failed';
  assert.deepEqual(healthProblems(doc, NOW), []);
});

test('unmatched tracker cards are reported', () => {
  const doc = healthy();
  doc.errors = ['Tracker rows with no spec match: GeForce RTX 5050 Ti'];
  assert.match(healthProblems(doc, NOW)[0], /RTX 5050 Ti.*names\.js/);
});

test('fingerprint ignores the day count so ageing data does not re-notify', () => {
  assert.equal(fingerprint(['retail: data is 12 days old']), fingerprint(['retail: data is 13 days old']));
  assert.notEqual(fingerprint(['retail: data is 12 days old']), fingerprint(['eBay: data is 12 days old']));
});
