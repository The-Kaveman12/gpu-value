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
 * Judge the current price against recent history:
 *   'low'  — at (or within 1% of) the lowest price in the last 30 days, and at
 *            least 3% below the 90-day average (a price that has sat flat for a
 *            month is not a deal just because it's also the minimum)
 *   'good' — at least 5% below the 90-day average
 *   'high' — at least 8% above the 90-day average
 *   null   — typical, or not enough history
 */
export function dealOf(points90, current) {
  if (current == null || points90.length < MIN_POINTS) return null;
  const last = dayMs(points90[points90.length - 1].day);
  const last30 = points90.filter((p) => dayMs(p.day) > last - 30 * DAY_MS);
  const low30 = Math.min(...last30.map((p) => p.price));
  const { avg } = stats(points90);
  const pct = Math.round(((current - avg) / avg) * 100);
  if (current <= low30 * 1.01 && pct <= -3) return { kind: 'low', label: '30-day low', pct };
  if (pct <= -5) return { kind: 'good', label: `${-pct}% below 90-day avg`, pct };
  if (pct >= 8) return { kind: 'high', label: `${pct}% above 90-day avg`, pct };
  return null;
}
