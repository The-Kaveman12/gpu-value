// Maintain history.json (format described in site/history.js).

import { isFresh } from './choose.js';

export const KEEP_DAYS = 400;

export function emptyHistory() {
  return { updated: null, days: [], cards: {} };
}

/**
 * Record one day's prices. `values` is { [gpuId]: { n, u } } (numbers or null).
 * Re-recording the same day overwrites it (the latest run of the day wins).
 * Days older than KEEP_DAYS before the newest day are dropped.
 */
export function recordDay(history, day, values, keepDays = KEEP_DAYS) {
  const h = history ?? emptyHistory();
  if (Object.keys(values).length === 0) return h; // nothing fresh that day: leave a gap
  let i = h.days.indexOf(day);
  if (i < 0) {
    if (h.days.length && day < h.days[h.days.length - 1]) {
      // Out-of-order day (backfill): insert in place.
      i = h.days.findIndex((d) => d > day);
      h.days.splice(i, 0, day);
      for (const c of Object.values(h.cards)) { c.n.splice(i, 0, null); c.u.splice(i, 0, null); }
    } else {
      h.days.push(day);
      for (const c of Object.values(h.cards)) { c.n.push(null); c.u.push(null); }
      i = h.days.length - 1;
    }
  }
  for (const [id, v] of Object.entries(values)) {
    const c = (h.cards[id] ??= { n: h.days.map(() => null), u: h.days.map(() => null) });
    c.n[i] = v.n ?? null;
    c.u[i] = v.u ?? null;
  }

  const newest = Date.parse(`${h.days[h.days.length - 1]}T00:00:00Z`);
  const drop = h.days.findIndex((d) => newest - Date.parse(`${d}T00:00:00Z`) < keepDays * 864e5);
  if (drop > 0) {
    h.days.splice(0, drop);
    for (const c of Object.values(h.cards)) { c.n.splice(0, drop); c.u.splice(0, drop); }
  }
  for (const [id, c] of Object.entries(h.cards)) if (c.n.every((x) => x == null) && c.u.every((x) => x == null)) delete h.cards[id];
  h.updated = new Date().toISOString();
  return h;
}

/** The day's values from a prices.json document: only quotes that are fresh at `now`. */
export function valuesFromPrices(prices, now = Date.now()) {
  const values = {};
  for (const [id, card] of Object.entries(prices.cards ?? {})) {
    const n = card.new && isFresh(card.new, now) ? card.new.price : null;
    const u = card.used && isFresh(card.used, now) ? card.used.price : null;
    if (n != null || u != null) values[id] = { n, u };
  }
  return values;
}

/** A copy with only the last `days` days, for the site. */
export function sliceHistory(h, days) {
  const start = Math.max(0, h.days.length - days);
  const cards = {};
  for (const [id, c] of Object.entries(h.cards)) {
    const n = c.n.slice(start);
    const u = c.u.slice(start);
    if (n.some((x) => x != null) || u.some((x) => x != null)) cards[id] = { n, u };
  }
  return { updated: h.updated, days: h.days.slice(start), cards };
}
