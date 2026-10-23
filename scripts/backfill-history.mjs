// One-off: rebuild past daily prices from archived sources, so the "good deal?"
// indicator works without waiting months for history to accumulate.
//
//   Retail: Wayback Machine copies of Tom's Hardware's GPU price tracker
//   eBay:   HardwareDeals.co's daily snapshot archive (historical-gpu-deals-data/)
//
// Each day is priced exactly as the live pipeline would have priced it on that
// day (same matcher, same freshness rules). Downloads are cached in <cacheDir>.
//
//   node scripts/backfill-history.mjs <days> <cacheDir> <history.json>

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCatalog } from './lib/catalog.js';
import { choosePrice, isFresh } from './lib/choose.js';
import { modelPattern, summarizeListings } from './lib/ebay.js';
import { toListings } from './lib/hardwaredeals.js';
import { emptyHistory, recordDay } from './lib/history.js';
import { BENCHMARK_ALIASES, normalizeName } from './lib/names.js';
import { parsePriceTracker } from './lib/tomshardware.js';

const [daysArg, cacheDir, historyPath] = process.argv.slice(2);
if (!daysArg || !cacheDir || !historyPath) throw new Error('usage: backfill-history.mjs <days> <cacheDir> <history.json>');
const DAYS = Number(daysArg);
const TRACKER = 'tomshardware.com/pc-components/gpus/lowest-gpu-prices-tracking';
const MIN_PRICE_FRACTION = { new: 0.45, used: 0.25 };
await mkdir(cacheDir, { recursive: true });

async function cached(name, url) {
  const file = join(cacheDir, name);
  try {
    return await readFile(file, 'utf8');
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    await writeFile(file, text);
    return text;
  }
}

const { gpus } = await loadCatalog();
const benchmarked = gpus.filter((g) => g.perf);
const byName = new Map(gpus.map((g) => [normalizeName(g.name), g]));
const patterns = new Map(benchmarked.map((g) => [g.id, modelPattern(g.benchmarkName, { memoryGb: g.memorySize, requireVram: g.hasMemoryVariants })]));

// Retail snapshots (one per archived day), oldest first.
const today = new Date();
const from = new Date(today - (DAYS + 30) * 864e5).toISOString().slice(0, 10).replaceAll('-', '');
const cdx = JSON.parse(await cached(`cdx-${from}.json`,
  `https://web.archive.org/cdx/search/cdx?url=${TRACKER}&from=${from}&output=json&filter=statuscode:200&collapse=timestamp:8&fl=timestamp`));
const retailSnapshots = [];
for (const [ts] of cdx.slice(1)) {
  try {
    const html = await cached(`tracker-${ts}.html`, `https://web.archive.org/web/${ts}id_/https://www.${TRACKER}`);
    const { updated, rows } = parsePriceTracker(html);
    const quotes = {};
    for (const row of rows) {
      const g = byName.get(normalizeName(BENCHMARK_ALIASES[row.card] ?? row.card));
      if (g) quotes[g.id] = { source: 'retail', price: row.price, outOfStock: row.outOfStock, fetched: updated };
    }
    // Usable from the moment it was archived; its freshness is judged by the page's own date.
    retailSnapshots.push({ archived: Date.parse(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:00Z`), quotes });
  } catch (err) {
    console.warn(`Skipping snapshot ${ts}: ${err.message}`);
  }
}
console.log(`Retail: ${retailSnapshots.length} archived tracker snapshots.`);

let history;
try {
  history = JSON.parse(await readFile(historyPath, 'utf8'));
} catch {
  history = emptyHistory();
}

for (let d = DAYS; d >= 1; d--) {
  const day = new Date(today - d * 864e5).toISOString().slice(0, 10);
  const endOfDay = Date.parse(`${day}T23:59:00Z`);
  const quotes = {};

  const retail = retailSnapshots.filter((s) => s.archived <= endOfDay).pop();
  if (retail) for (const [id, q] of Object.entries(retail.quotes)) (quotes[id] ??= {}).retail = q;

  try {
    const items = JSON.parse(await cached(`hd-${day}.json`,
      `https://raw.githubusercontent.com/HardwareDealsCo/gpu-deals/main/historical-gpu-deals-data/GPU-${day}.json`));
    const listings = toListings(items);
    for (const g of benchmarked) {
      for (const condition of ['new', 'used']) {
        const s = summarizeListings(listings[condition], patterns.get(g.id), { requireSeller: false, minPrice: (g.msrp ?? 100) * MIN_PRICE_FRACTION[condition] });
        if (s) (quotes[g.id] ??= {})[condition === 'new' ? 'hdNew' : 'hdUsed'] = { source: 'hardwaredeals', ...s, fetched: `${day}T11:00:00Z` };
      }
    }
  } catch (err) {
    console.warn(`${day}: no HardwareDeals snapshot (${err.message})`);
  }

  // Same choice and freshness rules as the live pipeline, evaluated on that day.
  const values = {};
  for (const [id, q] of Object.entries(quotes)) {
    const pick = (c) => {
      const p = choosePrice(q, c, endOfDay);
      return p && isFresh(p, endOfDay) ? p.price : null;
    };
    const n = pick('new');
    const u = pick('used');
    if (n != null || u != null) values[id] = { n, u };
  }
  recordDay(history, day, values);
  process.stdout.write(`${day}: ${Object.keys(values).length} cards\n`);
}

await writeFile(historyPath, JSON.stringify(history) + '\n');
console.log(`Wrote ${history.days.length} days to ${historyPath}.`);
