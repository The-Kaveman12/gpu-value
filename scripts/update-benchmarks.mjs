// Fetch Tom's Hardware's GPU Benchmarks Hierarchy (real game benchmarks,
// raster and ray tracing) and write data/benchmarks.json. Run by hand after
// Tom's Hardware updates the page; it makes a single request.
//
//   node scripts/update-benchmarks.mjs [saved-page.html]

import { readFile, writeFile } from 'node:fs/promises';
import { parseHierarchy } from './lib/tomshardware.js';

const URL_ = 'https://www.tomshardware.com/reviews/gpu-hierarchy,4388.html';

const html = process.argv[2]
  ? await readFile(process.argv[2], 'utf8')
  : await fetch(URL_, { headers: { 'User-Agent': 'gpu-value-checker (personal project; one request per manual update)' } }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${URL_}`);
      return r.text();
    });

const parsed = parseHierarchy(html);
const doc = {
  source: "Tom's Hardware GPU Benchmarks Hierarchy",
  sourceUrl: URL_,
  sourceUpdated: parsed.updated,
  retrieved: new Date().toISOString().slice(0, 10),
  note: 'Percentages are relative to the fastest card in each column; fps are averages across the test suite.',
  ...parsed.tables,
};
await writeFile(new URL('../data/benchmarks.json', import.meta.url), JSON.stringify(doc, null, 1) + '\n');
console.log(`Wrote ${doc.raster.length} raster and ${doc.rt.length} ray-tracing rows (page updated ${parsed.updated}).`);
