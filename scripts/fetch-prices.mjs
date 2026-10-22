// Collect prices from every available source and write site/data/prices.json.
//
// Sources (see scripts/lib/choose.js for how one price is picked per card):
//   retail         Tom's Hardware "lowest GPU prices" tracker: best US retail price, new
//   ebay           eBay Browse API, new + used (needs EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)
//   hardwaredeals  HardwareDeals.co daily snapshot of eBay listings, new + used (fallback)
//
// When a source fails, its previous quotes are carried forward with their
// original timestamps (from PREVIOUS_PRICES_URL or the local file), so the
// page shows their age instead of silently dropping them.
//
//   node scripts/fetch-prices.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadCatalog } from './lib/catalog.js';
import { choosePrice, SOURCES } from './lib/choose.js';
import { getAppToken, modelPattern, searchListings, summarizeListings } from './lib/ebay.js';
import { fetchHardwareDeals, HARDWAREDEALS_URL, toListings } from './lib/hardwaredeals.js';
import { BENCHMARK_ALIASES, normalizeName } from './lib/names.js';
import { parsePriceTracker } from './lib/tomshardware.js';

const OUT = new URL('../site/data/prices.json', import.meta.url);
const TRACKER_URL = 'https://www.tomshardware.com/pc-components/gpus/lowest-gpu-prices-tracking';
// Ignore listings far below MSRP: they are almost always accessories, boxes or scams.
const MIN_PRICE_FRACTION = { new: 0.45, used: 0.25 };
const CONCURRENCY = 4;
const QUOTE_KEYS = { retail: ['retail'], ebay: ['ebayNew', 'ebayUsed'], hardwaredeals: ['hdNew', 'hdUsed'] };

async function previousPrices() {
  try {
    if (process.env.PREVIOUS_PRICES_URL) {
      const res = await fetch(process.env.PREVIOUS_PRICES_URL);
      if (res.ok) return await res.json();
    }
    return JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: limit }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

const now = new Date().toISOString();
const { gpus } = await loadCatalog();
const benchmarked = gpus.filter((g) => g.perf);
const byName = new Map(gpus.map((g) => [normalizeName(g.name), g]));
const minPrice = (gpu, condition) => (gpu.msrp ?? 100) * MIN_PRICE_FRACTION[condition];
const patternFor = (gpu) => modelPattern(gpu.benchmarkName, { memoryGb: gpu.memorySize, requireVram: gpu.hasMemoryVariants });

const quotes = {}; // gpu id -> { retail, ebayNew, ebayUsed, hdNew, hdUsed }
const put = (id, key, quote) => ((quotes[id] ??= {})[key] = quote);
const sources = {};
const errors = [];

// --- Retail: Tom's Hardware tracker -------------------------------------------
try {
  const res = await fetch(TRACKER_URL, { headers: { 'User-Agent': 'gpu-value (personal price comparison; ~4 requests/day)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { updated, rows } = parsePriceTracker(await res.text());
  const fetched = updated ?? now;
  const unmatched = [];
  for (const row of rows) {
    const gpu = byName.get(normalizeName(BENCHMARK_ALIASES[row.card] ?? row.card));
    if (!gpu) { unmatched.push(row.card); continue; }
    put(gpu.id, 'retail', {
      source: 'retail', price: row.price, outOfStock: row.outOfStock, lowestEver: row.lowestEver, fetched, url: TRACKER_URL,
    });
  }
  if (unmatched.length) errors.push(`Tracker rows with no spec match: ${unmatched.join(', ')}`);
  sources.retail = { status: 'live', updated: fetched, rows: rows.length };
} catch (err) {
  errors.push(`Retail tracker: ${err.message}`);
  sources.retail = { status: 'failed' };
}

// --- eBay Browse API --------------------------------------------------------------
const { EBAY_CLIENT_ID: id, EBAY_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  sources.ebay = { status: 'unconfigured' };
} else {
  try {
    const token = await getAppToken(id, secret);
    let failures = 0;
    await mapLimit(benchmarked, CONCURRENCY, async (gpu) => {
      const model = patternFor(gpu);
      for (const condition of ['new', 'used']) {
        try {
          const items = await searchListings(token, { query: model.query, condition, minPrice: minPrice(gpu, condition) });
          const s = summarizeListings(items, model);
          if (s) put(gpu.id, condition === 'new' ? 'ebayNew' : 'ebayUsed', { source: 'ebay', ...s, query: model.query, fetched: now });
        } catch (err) {
          failures++;
          errors.push(`eBay ${gpu.name} (${condition}): ${err.message}`);
        }
      }
    });
    sources.ebay = { status: failures ? 'partial' : 'live', updated: now };
  } catch (err) {
    errors.push(`eBay: ${err.message}`);
    sources.ebay = { status: 'failed' };
  }
}

// --- HardwareDeals.co eBay snapshot --------------------------------------------
try {
  const { updated, items } = await fetchHardwareDeals({ token: process.env.GITHUB_TOKEN });
  const fetched = updated ?? now;
  const listings = toListings(items);
  for (const gpu of benchmarked) {
    const model = patternFor(gpu);
    for (const condition of ['new', 'used']) {
      const s = summarizeListings(listings[condition], model, { requireSeller: false, minPrice: minPrice(gpu, condition) });
      if (s) put(gpu.id, condition === 'new' ? 'hdNew' : 'hdUsed', { source: 'hardwaredeals', ...s, fetched, url: HARDWAREDEALS_URL });
    }
  }
  sources.hardwaredeals = { status: 'live', updated: fetched, listings: listings.new.length + listings.used.length };
} catch (err) {
  errors.push(`HardwareDeals: ${err.message}`);
  sources.hardwaredeals = { status: 'failed' };
}

// --- Carry forward quotes from sources that failed this run -----------------------
const prev = await previousPrices();
for (const [source, keys] of Object.entries(QUOTE_KEYS)) {
  if (sources[source].status === 'live' || sources[source].status === 'partial') continue;
  for (const [gpuId, card] of Object.entries(prev?.cards ?? {})) {
    for (const k of keys) {
      const old = card.quotes?.[k];
      if (old && !quotes[gpuId]?.[k]) put(gpuId, k, { ...old, carriedForward: true });
    }
  }
  if (prev?.sources?.[source]?.updated) sources[source].updated ??= prev.sources[source].updated;
}

// --- Choose and write ---------------------------------------------------------------
const cards = {};
for (const [gpuId, q] of Object.entries(quotes)) {
  cards[gpuId] = { new: choosePrice(q, 'new'), used: choosePrice(q, 'used'), quotes: q };
}
for (const [k, s] of Object.entries(sources)) Object.assign(s, { label: SOURCES[k].label, staleAfterHours: SOURCES[k].staleAfterHours });

const doc = {
  updated: now,
  method: 'New: lowest of the best US retail price and live eBay listings. Used: eBay listings. eBay prices are the median of the 5 cheapest exact-model matches.',
  sources,
  errors: errors.slice(0, 30),
  cards,
};
await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(doc, null, 1) + '\n');

const count = (c) => Object.values(cards).filter((x) => x[c]).length;
const scored = benchmarked.filter((g) => cards[g.id]?.new).length;
console.log(`prices.json: ${count('new')} cards with a new price (${scored}/${benchmarked.length} benchmarked), ${count('used')} with a used price.`);
console.log('Sources:', Object.entries(sources).map(([k, s]) => `${k}=${s.status}`).join(', '));
for (const e of errors.slice(0, 10)) console.warn(`  ${e}`);
