// Pick the price shown for each card from the quotes of several sources.
//
// New:  lowest of retail (Tom's Hardware tracker) and the eBay API;
//       HardwareDeals eBay listings only when neither is available.
// Used: the eBay API, else HardwareDeals eBay listings.
// Fresh quotes win; if every quote is stale, the most recent one is used and the
// page flags it.

export const SOURCES = {
  retail: { label: "Retail · Tom's Hardware tracker", short: 'retail', staleAfterHours: 24 * 10 },
  ebay: { label: 'eBay · live API', short: 'eBay', staleAfterHours: 48 },
  hardwaredeals: { label: 'eBay listings · HardwareDeals.co', short: 'eBay*', staleAfterHours: 72 },
};

export const MIN_LISTINGS = 3;

const TIERS = {
  new: [['retail', 'ebayNew'], ['hdNew']],
  used: [['ebayUsed'], ['hdUsed']],
};

const confident = (q) => q?.price != null && (q.listings == null || q.listings >= MIN_LISTINGS);
const fresh = (q, now) => (now - new Date(q.fetched)) / 36e5 <= (SOURCES[q.source]?.staleAfterHours ?? 48);

/** True if a quote is within its source's staleness window at `now`. */
export const isFresh = (q, now = Date.now()) => fresh(q, now);

/** quotes: { retail, ebayNew, ebayUsed, hdNew, hdUsed } (any may be missing). Returns a quote or null. */
export function choosePrice(quotes, condition, now = Date.now()) {
  for (const requireFresh of [true, false]) {
    for (const tier of TIERS[condition]) {
      const pool = tier.map((k) => quotes[k]).filter((q) => confident(q) && (!requireFresh || fresh(q, now)));
      if (!pool.length) continue;
      // Among fresh quotes take the cheapest; among stale ones the most recent.
      pool.sort(requireFresh ? (a, b) => a.price - b.price : (a, b) => new Date(b.fetched) - new Date(a.fetched));
      return pool[0];
    }
  }
  return null;
}
