import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choosePrice } from '../scripts/lib/choose.js';
import { toListings } from '../scripts/lib/hardwaredeals.js';
import { parsePriceTracker } from '../scripts/lib/tomshardware.js';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 36e5).toISOString();

test('parsePriceTracker reads every price table and out-of-stock rows', () => {
  const table = (rows) => `<table><tr><th>GPU Model</th><th>Best US Price</th><th>Lowest-Ever U.S. Price</th><th>MSRP Launch Price</th></tr>${rows}</table>`;
  const html = `<script>{"dateModified": "2026-10-19T13:10:16+00:00"}</script>
${table('<tr><td>GeForce RTX 5070</td><td><a href="#">$849</a></td><td>$479</td><td>$549</td></tr>')}
<table><tr><th>Something else</th></tr></table>
${table('<tr><td>Intel Arc B580</td><td>Out of Stock</td><td>$229</td><td>$250</td></tr><tr><td>GeForce RTX 5090</td><td>$7,998</td><td>$1,999</td><td>$1,999</td></tr>')}`;
  const { updated, rows } = parsePriceTracker(html);
  assert.equal(updated, '2026-10-19T13:10:16+00:00');
  assert.deepEqual(rows, [
    { card: 'GeForce RTX 5070', price: 849, lowestEver: 479, msrp: 549, outOfStock: false },
    { card: 'Intel Arc B580', price: null, lowestEver: 229, msrp: 250, outOfStock: true },
    { card: 'GeForce RTX 5090', price: 7998, lowestEver: 1999, msrp: 1999, outOfStock: false },
  ]);
});

test('toListings keeps US new/used listings once and strips tracking parameters', () => {
  const it = (condition, link, extra = {}) => ({ title: 't', price: '100.00', currency: 'USD', condition, link, ...extra });
  const out = toListings([
    it('Used', 'https://www.ebay.com/itm/1?campid=5'),
    it('Used', 'https://www.ebay.com/itm/1?campid=5'), // duplicate
    it('New', 'https://www.ebay.com/itm/2'),
    it('Open box', 'https://www.ebay.com/itm/3'),
    it('Gebraucht', 'https://www.ebay.com/itm/4'),
    it('Used', 'https://www.ebay.com/itm/5', { currency: 'EUR' }),
  ]);
  assert.deepEqual(out.used.map((l) => l.itemWebUrl), ['https://www.ebay.com/itm/1']);
  assert.deepEqual(out.new.map((l) => l.itemWebUrl), ['https://www.ebay.com/itm/2']);
});

test('choosePrice: new takes the cheaper of fresh retail and eBay', () => {
  const retail = { source: 'retail', price: 849, fetched: hoursAgo(72) };
  const ebayNew = { source: 'ebay', price: 799, listings: 8, fetched: hoursAgo(2) };
  const hdNew = { source: 'hardwaredeals', price: 500, listings: 9, fetched: hoursAgo(5) };
  assert.equal(choosePrice({ retail, ebayNew, hdNew }, 'new', NOW), ebayNew);
  assert.equal(choosePrice({ retail, hdNew }, 'new', NOW), retail); // snapshot only when nothing better
  assert.equal(choosePrice({ retail: { ...retail, price: null, outOfStock: true }, hdNew }, 'new', NOW), hdNew);
});

test('choosePrice: thin or stale quotes', () => {
  const thin = { source: 'ebay', price: 300, listings: 2, fetched: hoursAgo(1) };
  const staleRetail = { source: 'retail', price: 900, fetched: hoursAgo(24 * 30) };
  assert.equal(choosePrice({ ebayNew: thin }, 'new', NOW), null);
  assert.equal(choosePrice({ ebayNew: thin, retail: staleRetail }, 'new', NOW), staleRetail); // stale beats nothing
  const hdUsed = { source: 'hardwaredeals', price: 300, listings: 12, fetched: hoursAgo(10) };
  const ebayUsed = { source: 'ebay', price: 350, listings: 5, fetched: hoursAgo(1) };
  assert.equal(choosePrice({ hdUsed, ebayUsed }, 'used', NOW), ebayUsed); // live API preferred for used
  assert.equal(choosePrice({ hdUsed }, 'used', NOW), hdUsed);
});
