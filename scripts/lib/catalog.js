// Merge the spec database with the benchmark tables into one catalog.

import { readFile } from 'node:fs/promises';
import { BENCHMARK_ALIASES, normalizeName, SINGLE_RETAIL_VRAM } from './names.js';

const readJson = async (rel) => JSON.parse(await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8'));

export async function loadCatalog() {
  const specs = await readJson('data/specs.json');
  const benchmarks = await readJson('data/benchmarks.json');

  const byName = new Map(specs.gpus.map((g) => [normalizeName(g.name), g]));
  const baseName = (g) => normalizeName(g.name).replace(/ \d+ gb$/, '');
  const memoryVariants = new Map();
  for (const g of specs.gpus) {
    const k = baseName(g);
    if (!memoryVariants.has(k)) memoryVariants.set(k, new Set());
    memoryVariants.get(k).add(g.memorySize);
  }

  const missing = [];
  const bench = new Map();
  for (const kind of ['raster', 'rt']) {
    for (const row of benchmarks[kind]) {
      const gpu = byName.get(normalizeName(BENCHMARK_ALIASES[row.card] ?? row.card));
      if (!gpu) {
        missing.push(row.card);
        continue;
      }
      const entry = bench.get(gpu.id) ?? { card: row.card, msrp: row.msrp };
      entry[kind] = { '1080p': row['1080p'], '1440p': row['1440p'], '4k': row['4k'] };
      bench.set(gpu.id, entry);
    }
  }
  if (missing.length) {
    throw new Error(`Benchmark rows with no spec entry (add to BENCHMARK_ALIASES in scripts/lib/names.js): ${[...new Set(missing)].join(', ')}`);
  }

  const gpus = specs.gpus.map((g) => {
    const b = bench.get(g.id);
    if (!b) return g;
    const hasMemoryVariants = memoryVariants.get(baseName(g)).size > 1 && !SINGLE_RETAIL_VRAM.has(g.name);
    return { ...g, benchmarkName: b.card, msrp: b.msrp, perf: { raster: b.raster, rt: b.rt }, hasMemoryVariants };
  });
  return { specs, benchmarks, gpus };
}
