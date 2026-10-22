// eBay Browse API client plus the listing filters that turn raw search results
// into a trustworthy "current price" for one GPU model.
//
// Docs: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const GRAPHICS_CARDS_CATEGORY = '27386'; // Computers/Tablets & Networking > Computer Components & Parts > Graphics/Video Cards
const CONDITION_IDS = { new: '1000', used: '3000' };

export async function getAppToken(clientId, clientSecret) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });
  if (!res.ok) throw new Error(`eBay token request failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

/** Fixed-price US listings for one query and condition, cheapest first (price + shipping). */
export async function searchListings(token, { query, condition, minPrice }) {
  const filter = [
    `conditionIds:{${CONDITION_IDS[condition]}}`,
    'buyingOptions:{FIXED_PRICE}',
    'itemLocationCountry:US',
    'deliveryCountry:US',
    `price:[${Math.floor(minPrice)}..]`,
    'priceCurrency:USD',
  ].join(',');
  const params = new URLSearchParams({ q: query, category_ids: GRAPHICS_CARDS_CATEGORY, filter, sort: 'price', limit: '200' });
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
  });
  if (!res.ok) throw new Error(`eBay search "${query}" (${condition}) failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).itemSummaries ?? [];
}

// ---------------------------------------------------------------------------
// Title matching

const SUFFIXES = new Set(['ti', 'super', 'xt', 'xtx', 'gre']);
const BRAND_WORDS = new Set(['geforce', 'radeon', 'nvidia', 'amd', 'intel']);
const VRAM_SIZES = new Set([2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32]);

// Listings that aren't a single working card.
const REJECT =
  /\b(for parts|parts only|broken|defective|not working|as is|for repair|box only|empty box|no gpu|no card|bracket|backplate|water ?block|cooler only|heatsink only|fan only|replacement fan|shroud|riser|cable|laptop|notebook|mobile|gaming pc|desktop pc|desktop computer|computer|prebuilt|tower|mining rig|lot of|read description|untested|mxm)\b/;

/** Lowercase a title and separate glued tokens ("RTX5070Ti" -> "rtx 5070 ti", "16GB" -> "16 gb"). */
export function normalizeTitle(title) {
  return ` ${title.toLowerCase()} `
    .replace(/[-_/,()[\]|+:;"!*]/g, ' ')
    .replace(/\b(rtx|gtx|rx|arc)(?=[a-z]?\d)/g, '$1 ')
    .replace(/\b([a-z]?\d{3,4})(ti|super|xtx|xt|gre)\b/g, '$1 $2')
    .replace(/\b(\d+)\s*gb\b/g, '$1 gb')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Describe a model for matching, from a benchmark name like "GeForce RTX 4070 Ti Super",
 * "Radeon RX 9060 XT 16GB" or "Intel Arc B580". `requireVram` is set when the
 * same model ships with different memory sizes.
 */
export function modelPattern(name, { memoryGb, requireVram = false }) {
  const m = /\b(rtx|gtx|rx|arc)\s+([a-z]?\d{3,4})((?:\s+(?:ti|super|xtx|xt|gre))*)/i.exec(name);
  if (!m) throw new Error(`Can't build an eBay pattern for "${name}"`);
  return {
    prefix: m[1].toLowerCase(),
    number: m[2].toLowerCase(),
    suffixes: m[3].trim() ? m[3].trim().toLowerCase().split(/\s+/) : [],
    memoryGb,
    requireVram,
    query: `${m[1].toUpperCase()} ${m[2].toUpperCase()}${m[3] ? m[3].replace(/\b\w/g, (c) => c.toUpperCase()) : ''}${requireVram ? ` ${memoryGb}GB` : ''}`,
  };
}

/** True if a listing title is this exact model (not a Ti/Super/XT sibling or another VRAM size). */
export function titleMatches(title, model) {
  const t = normalizeTitle(title);
  if (REJECT.test(t)) return false;
  const tokens = t.split(' ');

  const found = tokens.some((tok, i) => {
    if (tok !== model.number) return false;
    const before = tokens[i - 1];
    if (model.prefix !== 'arc' && before !== model.prefix && !BRAND_WORDS.has(before)) return false;
    let j = i + 1;
    for (const s of model.suffixes) if (tokens[j++] !== s) return false;
    return !SUFFIXES.has(tokens[j]);
  });
  if (!found) return false;

  const vram = new Set([...t.matchAll(/\b(\d+) gb\b/g)].map((m) => Number(m[1])).filter((n) => VRAM_SIZES.has(n)));
  if (vram.size && !vram.has(model.memoryGb)) return false;
  if (model.requireVram && !vram.has(model.memoryGb)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Price summary

const MIN_SELLER_FEEDBACK_PCT = 97;
const MIN_SELLER_FEEDBACK_SCORE = 20;
const TYPICAL_OF_CHEAPEST = 5;

function totalPrice(item) {
  const price = Number(item.price?.value);
  const shipping = Number(item.shippingOptions?.[0]?.shippingCost?.value ?? 0);
  return Number.isFinite(price) ? price + (Number.isFinite(shipping) ? shipping : 0) : NaN;
}

/**
 * Reduce search results to a price summary. `price` is the median of the
 * cheapest few matching listings from established sellers, which resists
 * one-off scams and mislabeled items better than the single minimum.
 */
export function summarizeListings(items, model) {
  const matched = items
    .filter((it) => titleMatches(it.title ?? '', model))
    .filter((it) => {
      const s = it.seller ?? {};
      return Number(s.feedbackPercentage ?? 0) >= MIN_SELLER_FEEDBACK_PCT && Number(s.feedbackScore ?? 0) >= MIN_SELLER_FEEDBACK_SCORE;
    })
    .map((it) => ({ title: it.title, url: it.itemWebUrl, total: totalPrice(it) }))
    .filter((it) => Number.isFinite(it.total))
    .sort((a, b) => a.total - b.total);

  if (matched.length === 0) return null;
  const cheapest = matched.slice(0, TYPICAL_OF_CHEAPEST).map((it) => it.total);
  const mid = Math.floor(cheapest.length / 2);
  const typical = cheapest.length % 2 ? cheapest[mid] : (cheapest[mid - 1] + cheapest[mid]) / 2;
  return {
    price: Math.round(typical * 100) / 100,
    low: matched[0].total,
    listings: matched.length,
    examples: matched.slice(0, 3).map(({ title, url, total }) => ({ title, url, price: total })),
  };
}
