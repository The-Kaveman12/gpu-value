// Download the open GPU spec database (TechPowerUp data, compiled by
// RightNow-AI, Apache-2.0) and write a slimmed copy of every desktop and
// workstation card to data/specs.json.
//
//   node scripts/update-specs.mjs

import { writeFile } from 'node:fs/promises';
import { classify, PUBLISHED_SEGMENTS } from './lib/classify.js';

const REPO = 'RightNow-AI/RightNow-GPU-Database';
const SOURCE_URL = `https://raw.githubusercontent.com/${REPO}/main/data/all-gpus.json`;

const VENDORS = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel', '3dfx': '3dfx', matrox: 'Matrox', xgi: 'XGI', sony: 'Sony' };

// Fields kept for the site, in display order. Everything else is dropped.
const KEEP = [
  'architecture', 'gpuName', 'generation', 'releaseDate', 'processSize', 'foundry', 'transistors', 'dieSize',
  'memorySize', 'memoryType', 'memoryBus', 'memoryBandwidth', 'shaders', 'computeUnits', 'sms', 'executionUnits',
  'tmus', 'rops', 'rtCores', 'tensorCores', 'baseClock', 'boostClock', 'memoryClock', 'l2Cache', 'fp32',
  'tdp', 'suggestedPSU', 'powerConnectors', 'slot', 'length', 'busInterface', 'displayOutputs',
  'directX', 'vulkan', 'openGL', 'shaderModel', 'url',
];

async function lastCommitDate() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=1`);
  if (!res.ok) return null;
  const [commit] = await res.json();
  return commit?.commit?.committer?.date?.slice(0, 10) ?? null;
}

const res = await fetch(SOURCE_URL);
if (!res.ok) throw new Error(`Spec download failed: HTTP ${res.status}`);
const all = await res.json();

const counts = {};
const gpus = [];
for (const g of all) {
  const segment = classify(g);
  counts[segment] = (counts[segment] ?? 0) + 1;
  if (!PUBLISHED_SEGMENTS.has(segment)) continue;
  const out = { id: g.id, name: g.name, vendor: VENDORS[g.vendor] ?? g.vendor, segment };
  for (const k of KEEP) if (g[k] !== undefined && g[k] !== null && g[k] !== '') out[k] = g[k];
  gpus.push(out);
}
gpus.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || a.name.localeCompare(b.name));

const doc = {
  source: 'TechPowerUp GPU Database, compiled by RightNow-AI/RightNow-GPU-Database (Apache-2.0)',
  sourceUrl: `https://github.com/${REPO}`,
  sourceUpdated: await lastCommitDate(),
  retrieved: new Date().toISOString().slice(0, 10),
  gpus,
};
await writeFile(new URL('../data/specs.json', import.meta.url), JSON.stringify(doc, null, 1) + '\n');
console.log(`Wrote ${gpus.length} GPUs to data/specs.json. Segments in source:`, counts);
