// Merge specs and benchmarks into site/data/gpus.json for the web page.
//
//   node scripts/build.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { loadCatalog } from './lib/catalog.js';
import { featuresFor } from './lib/features.js';

const { specs, benchmarks, gpus } = await loadCatalog();

const doc = {
  built: new Date().toISOString(),
  sources: {
    specs: { name: specs.source, url: specs.sourceUrl, updated: specs.sourceUpdated, retrieved: specs.retrieved },
    benchmarks: { name: benchmarks.source, url: benchmarks.sourceUrl, updated: benchmarks.sourceUpdated, retrieved: benchmarks.retrieved },
  },
  gpus: gpus.map(({ hasMemoryVariants, ...g }) => ({ ...g, tech: featuresFor(g) })),
};

await mkdir(new URL('../site/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../site/data/gpus.json', import.meta.url), JSON.stringify(doc));
console.log(`site/data/gpus.json: ${gpus.length} GPUs, ${gpus.filter((g) => g.perf).length} with benchmarks.`);
