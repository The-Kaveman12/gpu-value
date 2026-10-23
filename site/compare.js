// Side-by-side comparison model, shared by the page and the tests.
//
// The comparison is a list of { id, slot } (slot 1-4 fixes each card's chart
// color, so removing one card never repaints the others). buildComparison()
// turns the cards into table rows; the page only renders them.

import { FEATURES } from './features.js';
import { perfOf, priceOf } from './logic.js';

export const MAX_COMPARE = 4;

/** Add a card, giving it the lowest free color slot. Returns the new list (unchanged if full or present). */
export function addToCompare(list, id) {
  if (list.some((c) => c.id === id) || list.length >= MAX_COMPARE) return list;
  const used = new Set(list.map((c) => c.slot));
  const slot = [1, 2, 3, 4].find((s) => !used.has(s));
  return [...list, { id, slot }];
}

export const removeFromCompare = (list, id) => list.filter((c) => c.id !== id);

/** URL form: "id~slot,id~slot". Invalid or duplicate entries are dropped. */
export const encodeCompare = (list) => list.map((c) => `${c.id}~${c.slot}`).join(',');
export function decodeCompare(text, knownIds) {
  let list = [];
  for (const part of (text ?? '').split(',').filter(Boolean)) {
    const [id, s] = part.split('~');
    const slot = Number(s);
    if (!knownIds.has(id) || list.some((c) => c.id === id)) continue;
    if (slot >= 1 && slot <= MAX_COMPARE && !list.some((c) => c.slot === slot)) list.push({ id, slot });
    else list = addToCompare(list, id);
    if (list.length === MAX_COMPARE) break;
  }
  return list;
}

const RES = [['1080p', '1080p'], ['1440p', '1440p'], ['4k', '4K']];

/**
 * Rows for the comparison table. Each row:
 *   { group, label, display: string[], values: (number|null)[], better: 'higher'|'lower'|null,
 *     best: number[] (column indexes), differs: boolean, current?: boolean, tech?: boolean }
 */
export function buildComparison(gpus, { prices, state, money, dealLabel = () => '' }) {
  const rows = [];
  const add = (group, label, cells, better = null, extra = {}) => {
    const values = cells.map((c) => (typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : null));
    const display = cells.map((c) => c.text ?? '—');
    const present = values.filter((v) => v != null);
    let best = [];
    if (better && present.length >= 2 && new Set(present).size > 1) {
      const target = better === 'higher' ? Math.max(...present) : Math.min(...present);
      best = values.flatMap((v, i) => (v === target ? [i] : []));
    }
    rows.push({ group, label, display, values, better, best, differs: new Set(display).size > 1, ...extra });
  };
  const num = (v, fmt) => (v == null || v === '' ? { value: null, text: '—' } : { value: v, text: fmt ? fmt(v) : String(v) });
  const usd = (p) => (p ? { value: p, text: money(p) } : { value: null, text: '—' });

  // Value & price, at the page's current settings.
  const basisLabel = { new: 'new', used: 'used', msrp: 'MSRP' }[state.basis];
  const perf = gpus.map((g) => perfOf(g, state));
  const price = gpus.map((g) => priceOf(g, prices, state.basis));
  add('Value & price', 'FPS per $100', gpus.map((g, i) => (perf[i] && price[i] ? num((perf[i].fps / price[i].price) * 100, (v) => v.toFixed(1)) : num(null))), 'higher');
  add('Value & price', `Price (${basisLabel})`, gpus.map((g, i) => {
    if (!price[i]) return num(null);
    const tag = state.basis === 'msrp' ? '' : dealLabel(g, price[i]);
    return { value: price[i].price, text: `${money(price[i].price)}${tag ? ` · ${tag}` : ''}` };
  }), 'lower');
  add('Value & price', 'New', gpus.map((g) => usd(prices?.cards?.[g.id]?.new?.price)), 'lower');
  add('Value & price', 'Used', gpus.map((g) => usd(prices?.cards?.[g.id]?.used?.price)), 'lower');
  add('Value & price', 'Launch MSRP', gpus.map((g) => usd(g.msrp)), null);

  // Performance: average fps, ultra settings.
  for (const [kind, kindLabel] of [['raster', 'Raster'], ['rt', 'Ray tracing']]) {
    for (const [res, resLabel] of RES) {
      const current = state.res === res && (state.work === kind || state.work === 'mixed');
      add('Performance (avg FPS)', `${kindLabel} ${resLabel}`, gpus.map((g) => num(g.perf?.[kind]?.[res]?.fps, (v) => v.toFixed(0))), 'higher', { current });
    }
  }

  // Specs. Clocks and core counts aren't comparable across architectures, so no "best".
  const spec = (label, key, fmt, better = null) => add('Specs', label, gpus.map((g) => num(g[key], fmt)), better);
  add('Specs', 'Memory', gpus.map((g) => (g.memorySize ? { value: g.memorySize, text: `${g.memorySize} GB ${g.memoryType ?? ''}`.trim() } : num(null))), 'higher');
  spec('Memory bandwidth', 'memoryBandwidth', (v) => `${Math.round(v)} GB/s`, 'higher');
  spec('Memory bus', 'memoryBus', (v) => `${v}-bit`);
  spec('Boost clock', 'boostClock', (v) => `${(v / 1000).toFixed(2)} GHz`);
  spec('Shading units', 'shaders', (v) => v.toLocaleString('en-US'));
  spec('Board power', 'tdp', (v) => `${v} W`, 'lower');
  spec('Suggested PSU', 'suggestedPSU', (v) => `${v} W`, 'lower');
  spec('Power connectors', 'powerConnectors');
  spec('Length', 'length', (v) => `${v} mm`);
  spec('Slot width', 'slot');
  spec('Interface', 'busInterface');
  spec('Architecture', 'architecture');
  add('Specs', 'Released', gpus.map((g) => (g.releaseDate ? { value: null, text: g.releaseDate.slice(0, 7) } : num(null))));

  // Technologies.
  for (const f of FEATURES) {
    add('Technologies', f.label, gpus.map((g) => ({ value: null, text: g.tech?.[f.id] ? `✓ ${g.tech[f.id]}` : '—' })), null, { tech: true, hint: f.hint });
  }
  return rows;
}
