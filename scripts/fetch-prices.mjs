// Fetch live eBay prices (new and used) for every benchmarked card and write
// site/data/prices.json. Needs EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.
//
// If credentials are missing or a lookup fails, the previous price for that
// card is carried forward with its original timestamp, so the site shows how
// old it is instead of silently dropping it. Previous prices come from
// PREVIOUS_PRICES_URL (the live site) or the local file.
//
//   EBAY_CLIENT_ID=... EBAY_CLIENT_SECRET=... node scripts/fetch-prices.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadCatalog } from './lib/catalog.js';
import { getAppToken, modelPattern, searchListings, summarizeListings } from './lib/ebay.js';

const OUT = new URL('../site/data/prices.json', import.meta.url);
const CONDITIONS = ['new', 'used'];
// Ignore listings far below MSRP: they are almost always accessories, boxes or scams.
const MIN_PRICE_FRACTION = { new: 0.45, used: 0.25 };
const CONCURRENCY = 4;

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

const { gpus } = await loadCatalog();
const targets = gpus.filter((g) => g.perf);
const prevDoc = await previousPrices();
const previous = prevDoc?.cards ?? {};
const cards = {};
const errors = [];
const now = new Date().toISOString();

const { EBAY_CLIENT_ID: id, EBAY_CLIENT_SECRET: secret } = process.env;
let status = 'live';

if (!id || !secret) {
  status = 'unconfigured';
  console.warn('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set: keeping previous prices only.');
} else {
  const token = await getAppToken(id, secret);
  await mapLimit(targets, CONCURRENCY, async (gpu) => {
    const model = modelPattern(gpu.benchmarkName, { memoryGb: gpu.memorySize, requireVram: gpu.hasMemoryVariants });
    for (const condition of CONDITIONS) {
      try {
        const items = await searchListings(token, { query: model.query, condition, minPrice: (gpu.msrp ?? 100) * MIN_PRICE_FRACTION[condition] });
        const summary = summarizeListings(items, model);
        if (summary) (cards[gpu.id] ??= {})[condition] = { ...summary, query: model.query, fetched: now };
      } catch (err) {
        errors.push(`${gpu.name} (${condition}): ${err.message}`);
      }
    }
  });
  if (errors.length) status = 'partial';
}

// Carry forward anything we didn't refresh this run.
for (const gpu of targets) {
  for (const condition of CONDITIONS) {
    const old = previous[gpu.id]?.[condition];
    if (old && !cards[gpu.id]?.[condition]) (cards[gpu.id] ??= {})[condition] = { ...old, carriedForward: true };
  }
}

const doc = {
  source: 'eBay Browse API (US, Buy It Now, sellers with ≥97% feedback)',
  method: 'Median of the 5 cheapest matching listings, shipping included',
  updated: status === 'unconfigured' ? prevDoc?.updated ?? null : now,
  status,
  errors: errors.slice(0, 20),
  cards,
};
await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(doc, null, 1) + '\n');

const priced = Object.values(cards).filter((c) => c.new || c.used).length;
console.log(`prices.json: status=${status}, ${priced}/${targets.length} cards priced, ${errors.length} errors.`);
for (const e of errors.slice(0, 10)) console.warn(`  ${e}`);
