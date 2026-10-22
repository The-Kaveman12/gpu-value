// Adapter for the open HardwareDeals.co GPU dataset (MIT): a daily snapshot of
// eBay listings. Listings have no seller rating or shipping cost, so they only
// back up the eBay API, and every card needs several exact-model matches.
//
// https://github.com/HardwareDealsCo/gpu-deals

const REPO = 'HardwareDealsCo/gpu-deals';
const FILE = 'current-gpu-deals.json';
export const HARDWAREDEALS_URL = `https://github.com/${REPO}`;

// Only plain US-style conditions. "Gebraucht" etc. come from non-US eBay sites,
// and "Open box" is neither new nor used.
const CONDITIONS = { New: 'new', Used: 'used' };

/** Fetch the snapshot. Returns { updated: ISO | null, items: [...] }. */
export async function fetchHardwareDeals({ token } = {}) {
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${FILE}`);
  if (!res.ok) throw new Error(`HardwareDeals download failed: HTTP ${res.status}`);
  const items = await res.json();

  let updated = null;
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const c = await fetch(`https://api.github.com/repos/${REPO}/commits?path=${FILE}&per_page=1`, { headers });
    if (c.ok) updated = (await c.json())[0]?.commit?.committer?.date ?? null;
  } catch {
    // Leave `updated` null; the caller falls back to the fetch time.
  }
  return { updated, items };
}

/**
 * Normalize raw records into the eBay item-summary shape that
 * summarizeListings() understands, split by condition and de-duplicated.
 */
export function toListings(items) {
  const out = { new: [], used: [] };
  const seen = new Set();
  for (const it of items) {
    const condition = CONDITIONS[it.condition];
    if (!condition || it.currency !== 'USD' || !it.link) continue;
    const url = it.link.split('?')[0]; // drop tracking parameters
    if (seen.has(url)) continue;
    seen.add(url);
    out[condition].push({ title: it.title ?? '', itemWebUrl: url, price: { value: it.price } });
  }
  return out;
}
