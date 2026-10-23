// Add today's prices to the price history and write the site's copy.
//
//   node scripts/update-history.mjs <history.json> [site/data/history.json]
//
// Reads site/data/prices.json; records only quotes that are fresh, so a stale,
// carried-forward price never gets logged as today's price.

import { readFile, writeFile } from 'node:fs/promises';
import { emptyHistory, recordDay, sliceHistory, valuesFromPrices } from './lib/history.js';

const SITE_DAYS = 180;
const [historyPath, sitePath = 'site/data/history.json'] = process.argv.slice(2);
if (!historyPath) throw new Error('usage: update-history.mjs <history.json> [site copy]');

const prices = JSON.parse(await readFile('site/data/prices.json', 'utf8'));
let history;
try {
  history = JSON.parse(await readFile(historyPath, 'utf8'));
} catch {
  history = emptyHistory();
}

const day = prices.updated.slice(0, 10);
const values = valuesFromPrices(prices, Date.parse(prices.updated));
recordDay(history, day, values);

await writeFile(historyPath, JSON.stringify(history) + '\n');
await writeFile(sitePath, JSON.stringify(sliceHistory(history, SITE_DAYS)));
console.log(`History: recorded ${Object.keys(values).length} cards for ${day}; ${history.days.length} days stored.`);
