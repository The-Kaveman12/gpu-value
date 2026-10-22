import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { featuresFor } from '../scripts/lib/features.js';
import { derive } from '../site/logic.js';

const catalog = JSON.parse(await readFile(new URL('../site/data/gpus.json', import.meta.url), 'utf8'));
const tech = (name) => Object.keys(catalog.gpus.find((g) => g.name === name).tech).sort();

test('NVIDIA generations get the right technologies', () => {
  assert.deepEqual(tech('GeForce RTX 5070'), ['ai-denoise', 'ai-upscaling', 'av1-encode', 'dlss5', 'driver-frame-gen', 'frame-gen', 'hw-rt', 'multi-frame-gen', 'rtx-hdr', 'vrr']);
  assert.deepEqual(tech('GeForce RTX 4070'), ['ai-denoise', 'ai-upscaling', 'av1-encode', 'driver-frame-gen', 'frame-gen', 'hw-rt', 'rtx-hdr', 'vrr']);
  assert.deepEqual(tech('GeForce RTX 3060 12 GB'), ['ai-denoise', 'ai-upscaling', 'hw-rt', 'rtx-hdr', 'vrr']);
  assert.deepEqual(tech('GeForce GTX 1660 SUPER'), ['vrr']); // Turing without RTX hardware
});

test('AMD and Intel generations get the right technologies', () => {
  assert.deepEqual(tech('Radeon RX 9070 XT'), ['ai-denoise', 'ai-upscaling', 'av1-encode', 'driver-frame-gen', 'frame-gen', 'hw-rt', 'vrr']);
  assert.deepEqual(tech('Radeon RX 7800 XT'), ['ai-upscaling', 'av1-encode', 'driver-frame-gen', 'frame-gen', 'hw-rt', 'vrr']); // FSR 4 on RDNA 3
  assert.deepEqual(tech('Radeon RX 6700 XT'), ['driver-frame-gen', 'frame-gen', 'hw-rt', 'vrr']);
  assert.deepEqual(tech('Radeon RX 5700 XT'), ['frame-gen', 'vrr']);
  assert.deepEqual(tech('Radeon HD 7970'), []); // GCN 1.0: no FreeSync for games
  assert.deepEqual(tech('Arc B580'), ['ai-upscaling', 'av1-encode', 'frame-gen', 'hw-rt', 'multi-frame-gen', 'vrr']);
});

test('consumer-only features are not given to workstation cards', () => {
  const t = featuresFor({ name: 'RTX PRO 6000 Blackwell', vendor: 'NVIDIA', architecture: 'Blackwell 2.0', segment: 'workstation', tensorCores: 752, directX: '12.2' });
  assert.ok(t['ai-upscaling'] && t['multi-frame-gen']);
  assert.ok(!t.dlss5 && !t['rtx-hdr'] && !t['driver-frame-gen']);
});

test('technology filter requires every selected feature', () => {
  const base = { q: '', res: '1440p', work: 'raster', basis: 'msrp', vendors: [], tech: [], minVram: 0, maxPrice: null, minFps: null, segment: 'desktop', sort: 'value', dir: null, rankedOnly: false };
  const mfg = derive(catalog.gpus, null, { ...base, tech: ['multi-frame-gen'] }).rows;
  assert.ok(mfg.length > 0 && mfg.every((r) => r.g.tech['multi-frame-gen']));
  assert.ok(mfg.some((r) => r.g.vendor === 'Intel') && mfg.some((r) => r.g.vendor === 'NVIDIA'));
  const both = derive(catalog.gpus, null, { ...base, tech: ['multi-frame-gen', 'dlss5'] }).rows;
  assert.ok(both.length > 0 && both.every((r) => /RTX 50/.test(r.g.name)));
  assert.ok(derive(catalog.gpus, null, { ...base, q: 'smooth motion' }).rows.every((r) => r.g.tech['driver-frame-gen']));
});
