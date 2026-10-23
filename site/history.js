// Price history helpers shared by the page and the tests.
//
// history.json: { updated, days: ['YYYY-MM-DD', ...], cards: { [gpuId]: { n: [...], u: [...] } } }
// n / u are the new / used price on each day in `days` (null when unknown).

const DAY_MS = 864e5;
const KIND = { new: 'n', used: 'u' };
const dayMs = (d) => Date.parse(`${d}T12:00:00Z`);

/** Points [{ day, price }] for one card and condition, oldest first, over the last `days` days. */
export function seriesFor(history, id, condition, days = 90) {
  const values = history?.cards?.[id]?.[KIND[condition]];
  if (!values) return [];
  const lastDay = history.days[history.days.length - 1];
  const from = dayMs(lastDay) - (days - 1) * DAY_MS;
  return history.days
    .map((day, i) => ({ day, price: values[i] }))
    .filter((p) => p.price != null && dayMs(p.day) >= from);
}

export function stats(points) {
  if (!points.length) return null;
  const prices = points.map((p) => p.price);
  return { min: Math.min(...prices), max: Math.max(...prices), avg: prices.reduce((a, b) => a + b, 0) / prices.length, n: prices.length };
}

const MIN_POINTS = 10; // need at least this many days of history to judge a price

/**
 * Judge the current price against the card's own recent history:
 *   'great' — at least 10% below the 90-day average, or the lowest price in
 *             90 days (while at least 3% below average)
 *   'good'  — at least 5% below the 90-day average, or the lowest price in
 *             30 days (while at least 3% below average)
 *   'high'  — at least 8% above the 90-day average
 *   null    — typical, or not enough history
 * The "at least 3% below average" guard keeps a price that has sat flat for
 * months from counting as a deal just because it's also the minimum.
 * Returns { kind, reason, label, pct, avg }: reason is short ("90-day low",
 * "12% below avg"), label is the full tag text.
 */
export function dealOf(points90, current) {
  if (current == null || points90.length < MIN_POINTS) return null;
  const last = dayMs(points90[points90.length - 1].day);
  const low30 = Math.min(...points90.filter((p) => dayMs(p.day) > last - 30 * DAY_MS).map((p) => p.price));
  const { avg, min: low90 } = stats(points90);
  const pct = Math.round(((current - avg) / avg) * 100);
  const below = `${-pct}% below avg`;
  const make = (kind, reason) => ({
    kind,
    reason,
    label: kind === 'high' ? reason : `${kind === 'great' ? 'Great' : 'Good'} deal · ${reason}`,
    pct,
    avg,
  });

  const at90Low = current <= low90 * 1.005 && pct <= -3;
  const at30Low = current <= low30 * 1.01 && pct <= -3;
  if (pct <= -10) return make('great', below);
  if (at90Low) return make('great', '90-day low');
  if (pct <= -5) return make('good', below);
  if (at30Low) return make('good', '30-day low');
  if (pct >= 8) return make('high', `${pct}% above avg`);
  return null;
}

export const isDeal = (deal) => deal?.kind === 'great' || deal?.kind === 'good';
