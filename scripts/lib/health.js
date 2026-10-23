// Decide whether the price data needs attention, from site/data/prices.json.
// Problems are about data that is actually going stale or disappearing, not
// one-off failures: a source that fails once is carried forward and recovers.

// Fewer cards than this with a new price means a source probably broke
// (34 of 48 benchmarked cards were priced when this was written).
export const MIN_PRICED_CARDS = 20;

const SOURCE_NAMES = { retail: "Tom's Hardware retail tracker", ebay: 'eBay API', hardwaredeals: 'HardwareDeals eBay snapshot' };

/** Returns a list of human-readable problems; empty means healthy. */
export function healthProblems(doc, now = Date.now()) {
  if (!doc) return ['site/data/prices.json is missing, so the price fetch probably crashed.'];
  const problems = [];

  for (const [key, s] of Object.entries(doc.sources ?? {})) {
    if (s.status === 'unconfigured') continue; // expected until API keys are added
    const name = SOURCE_NAMES[key] ?? key;
    if (!s.updated) {
      problems.push(`${name}: no successful update on record (status: ${s.status}).`);
      continue;
    }
    const hours = (now - new Date(s.updated)) / 36e5;
    if (hours > s.staleAfterHours) {
      problems.push(`${name}: data is ${Math.round(hours / 24)} days old (limit ${Math.round(s.staleAfterHours / 24)} days, status: ${s.status}).`);
    }
  }

  const priced = Object.values(doc.cards ?? {}).filter((c) => c.new).length;
  if (priced < MIN_PRICED_CARDS) {
    problems.push(`Only ${priced} cards have a new price (expected at least ${MIN_PRICED_CARDS}). A source's page layout may have changed.`);
  }

  for (const e of doc.errors ?? []) {
    // New cards in the retail tracker that aren't in the spec database lose their price.
    if (/^Tracker rows with no spec match/.test(e)) problems.push(`${e}. Add aliases in scripts/lib/names.js or update the spec database.`);
  }
  return problems;
}

/** Short stable fingerprint of a problem list, used to avoid repeat notifications. */
export function fingerprint(problems) {
  let h = 0;
  for (const ch of problems.join('\n').replace(/\d+ days old/g, 'N days old')) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(16);
}
