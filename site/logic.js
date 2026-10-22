// Pure ranking logic, shared by the page (app.js) and the tests.

export const MIXED_RT_WEIGHT = 0.3;
export const SORT_DIR = { value: 'desc', perf: 'desc', price: 'asc', vram: 'desc', release: 'desc', name: 'asc', tdp: 'asc' };
const MAIN_VENDORS = new Set(['NVIDIA', 'AMD', 'Intel']);

export const vendorKey = (g) => (MAIN_VENDORS.has(g.vendor) ? g.vendor : 'Other');

export function searchText(g) {
  return [g.name, g.vendor, g.architecture, g.gpuName, g.generation, g.memoryType, g.memorySize && `${g.memorySize}gb ${g.memorySize} gb`, g.releaseDate?.slice(0, 4), ...Object.values(g.tech ?? {})]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Average fps and % of fastest card for the chosen resolution and workload, or null. */
export function perfOf(g, { res, work }) {
  if (!g.perf) return null;
  const r = g.perf.raster?.[res];
  const t = g.perf.rt?.[res];
  if (work === 'raster') return r ? { fps: r.fps, pct: r.pct } : null;
  if (work === 'rt') return t ? { fps: t.fps, pct: t.pct } : null;
  if (!r || !t) return null;
  const w = MIXED_RT_WEIGHT;
  return { fps: (1 - w) * r.fps + w * t.fps, pct: (1 - w) * r.pct + w * t.pct };
}

/** The price used for value: live eBay new/used, or launch MSRP. */
export function priceOf(g, prices, basis) {
  if (basis === 'msrp') return g.msrp ? { price: g.msrp, kind: 'msrp' } : null;
  const p = prices?.cards?.[g.id]?.[basis];
  return p ? { ...p, kind: basis } : null;
}

/**
 * Filter and sort GPUs. Returns { rows, ranked }: rows in display order, and
 * the subset with a value score ordered best first (each has `rank`).
 */
export function derive(gpus, prices, state) {
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = [];
  for (const g of gpus) {
    if (state.segment !== 'all' && g.segment !== state.segment) continue;
    if (state.vendors.length && !state.vendors.includes(vendorKey(g))) continue;
    if ((g.memorySize ?? 0) < state.minVram) continue;
    if (state.tech?.length && !state.tech.every((id) => g.tech?.[id])) continue;
    if (terms.length) {
      const hay = (g._search ??= searchText(g));
      if (!terms.every((t) => hay.includes(t))) continue;
    }
    const perf = perfOf(g, state);
    const price = priceOf(g, prices, state.basis);
    if (state.maxPrice && (!price || price.price > state.maxPrice)) continue;
    if (state.minFps && (!perf || perf.fps < state.minFps)) continue;
    const value = perf && price ? (perf.fps / price.price) * 100 : null;
    if (state.rankedOnly && value == null) continue;
    rows.push({ g, perf, price, value });
  }

  const ranked = rows.filter((r) => r.value != null).sort((a, b) => b.value - a.value);
  ranked.forEach((r, i) => (r.rank = i + 1));

  const sign = (state.dir ?? SORT_DIR[state.sort]) === 'asc' ? 1 : -1;
  const key = {
    value: (r) => r.value,
    perf: (r) => r.perf?.fps,
    price: (r) => r.price?.price,
    vram: (r) => r.g.memorySize,
    release: (r) => r.g.releaseDate,
    name: (r) => r.g.name.toLowerCase(),
    tdp: (r) => r.g.tdp,
  }[state.sort] ?? ((r) => r.value);
  rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    // Cards without the sort field go last, newest first.
    if (x == null && y == null) return (b.g.releaseDate ?? '').localeCompare(a.g.releaseDate ?? '');
    if (x == null) return 1;
    if (y == null) return -1;
    return x < y ? -sign : x > y ? sign : 0;
  });
  return { rows, ranked };
}
