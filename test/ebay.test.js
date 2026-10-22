import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelPattern, normalizeTitle, summarizeListings, titleMatches } from '../scripts/lib/ebay.js';
import { classify } from '../scripts/lib/classify.js';

test('normalizeTitle splits glued tokens', () => {
  assert.equal(normalizeTitle('MSI RTX5070Ti 16GB GDDR7'), 'msi rtx 5070 ti 16 gb gddr7');
  assert.equal(normalizeTitle('ASRock Radeon RX9070XT Steel Legend'), 'asrock radeon rx 9070 xt steel legend');
});

test('modelPattern builds queries', () => {
  assert.equal(modelPattern('GeForce RTX 4070 Ti Super', { memoryGb: 16 }).query, 'RTX 4070 Ti Super');
  assert.equal(modelPattern('Radeon RX 9060 XT 16GB', { memoryGb: 16, requireVram: true }).query, 'RX 9060 XT 16GB');
  assert.equal(modelPattern('Intel Arc B580', { memoryGb: 12 }).query, 'ARC B580');
});

test('titleMatches accepts the exact model and rejects siblings', () => {
  const rtx5070 = modelPattern('GeForce RTX 5070', { memoryGb: 12 });
  assert.ok(titleMatches('MSI GeForce RTX 5070 12GB Ventus 2X OC GDDR7 Graphics Card', rtx5070));
  assert.ok(titleMatches('ZOTAC Gaming RTX5070 Twin Edge 12G', rtx5070));
  assert.ok(!titleMatches('ASUS TUF RTX 5070 Ti 16GB', rtx5070));
  assert.ok(!titleMatches('RTX 5070Ti Gaming OC', rtx5070));
  assert.ok(!titleMatches('RTX 5070 for parts not working', rtx5070));
  assert.ok(!titleMatches('Gaming PC Ryzen 7 RTX 5070 32GB', rtx5070));
  assert.ok(!titleMatches('GeForce RTX 5070 empty box only', rtx5070));

  const tiSuper = modelPattern('GeForce RTX 4070 Ti Super', { memoryGb: 16 });
  assert.ok(titleMatches('Gigabyte RTX 4070 Ti SUPER Windforce 16GB', tiSuper));
  assert.ok(!titleMatches('Gigabyte RTX 4070 Ti Windforce 12GB', tiSuper));
  const ti = modelPattern('GeForce RTX 4070 Ti', { memoryGb: 12 });
  assert.ok(!titleMatches('Gigabyte RTX 4070 Ti SUPER Windforce 16GB', ti));

  const xt16 = modelPattern('Radeon RX 9060 XT 16GB', { memoryGb: 16, requireVram: true });
  assert.ok(titleMatches('Sapphire PULSE AMD Radeon RX 9060 XT 16GB GDDR6', xt16));
  assert.ok(!titleMatches('Sapphire PULSE AMD Radeon RX 9060 XT 8GB GDDR6', xt16));
  assert.ok(!titleMatches('Sapphire PULSE AMD Radeon RX 9060 XT GDDR6', xt16));
  assert.ok(!titleMatches('XFX Radeon RX 9060 16GB', xt16));

  const rx7600 = modelPattern('Radeon RX 7600', { memoryGb: 8 });
  assert.ok(!titleMatches('PowerColor RX 7600 XT Hellhound 16GB', rx7600));
  assert.ok(titleMatches('PowerColor Fighter AMD Radeon RX 7600 8GB', rx7600));

  const b580 = modelPattern('Intel Arc B580', { memoryGb: 12 });
  assert.ok(titleMatches('Intel Arc B580 Limited Edition 12GB', b580));
  assert.ok(titleMatches('Sparkle Intel ARC B580 Titan OC', b580));
  assert.ok(!titleMatches('Intel Arc B570 10GB', b580));
});

test('summarizeListings uses the median of the cheapest five from good sellers', () => {
  const model = modelPattern('GeForce RTX 5070', { memoryGb: 12 });
  const item = (title, price, ship = 0, pct = '99.8', score = 500) => ({
    title, itemWebUrl: `https://ebay.com/itm/${price}`,
    price: { value: String(price), currency: 'USD' },
    shippingOptions: [{ shippingCost: { value: String(ship), currency: 'USD' } }],
    seller: { feedbackPercentage: pct, feedbackScore: score },
  });
  const s = summarizeListings([
    item('RTX 5070 OC', 300, 0, '80.0'), // bad feedback: ignored
    item('RTX 5070 Ti', 650), // wrong model
    item('RTX 5070 A', 560, 10),
    item('RTX 5070 B', 575),
    item('RTX 5070 C', 590),
    item('RTX 5070 D', 600),
    item('RTX 5070 E', 610),
    item('RTX 5070 F', 999),
  ], model);
  assert.equal(s.low, 570);
  assert.equal(s.price, 590);
  assert.equal(s.listings, 6);
  assert.equal(s.examples.length, 3);
  assert.equal(summarizeListings([item('RTX 5070 Ti', 700)], model), null);
});

test('classify separates desktop cards from laptop, integrated and server parts', () => {
  assert.equal(classify({ name: 'GeForce RTX 5070', generation: 'GeForce 50' }), 'desktop');
  assert.equal(classify({ name: 'GeForce RTX 5070 Mobile', generation: 'GeForce 50 Mobile' }), 'mobile');
  assert.equal(classify({ name: 'Radeon RX 7900M', generation: 'Navi Mobile(RX 7000M)' }), 'mobile');
  assert.equal(classify({ name: 'GeForce RTX 3070 TiM', generation: 'GeForce 30' }), 'mobile');
  assert.equal(classify({ name: 'RTX 5000 Ada Generation', generation: 'Workstation Ada(x000A)' }), 'workstation');
  assert.equal(classify({ name: 'H100 PCIe', generation: 'Server Hopper(Hxx)' }), 'datacenter');
  assert.equal(classify({ name: 'Radeon 780M', generation: 'Navi III IGP(Phoenix)' }), 'integrated');
  assert.equal(classify({ name: 'Arc B580', generation: 'Battlemage(Arc 5)' }), 'desktop');
});

test('titleMatches rejects listings flagged with defects or caveats', () => {
  const xt = modelPattern('Radeon RX 9070 XT', { memoryGb: 16 });
  assert.ok(titleMatches('Asus Radeon RX 9070 XT Prime OC 16GB GDDR6 Graphics Card', xt));
  assert.ok(!titleMatches('ASROCK CHALLENGER AMD RADEON RX 9070XT 16GB GDDR6 DESKTOP GPU *NO HDMI* *READ*', xt));
  assert.ok(!titleMatches('RX 9070 XT 16GB artifacting', xt));
  assert.ok(!titleMatches('RX 9070 XT 16GB - no display output', xt));
});
