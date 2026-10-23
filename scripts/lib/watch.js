// Price alerts. Each alert is a GitHub issue labeled "price-watch" whose body
// has three lines the site fills in:
//
//   card: amd-radeon-rx-9070-xt
//   condition: new
//   target: 700
//
// After every price update the issue gets a comment only when something
// changes: confirmation on creation, the price reaching the target, dropping a
// further 3%+, or going back above the target. State lives in a hidden marker
// in the issue body so nothing repeats.

export const WATCH_LABEL = 'price-watch';
const STATE_RE = /<!-- watch-state (\{.*?\}) -->/;
const FURTHER_DROP = 0.97;

export function parseWatch(body = '') {
  const card = /^\s*card:\s*(\S+)/im.exec(body)?.[1];
  const condition = /^\s*condition:\s*(new|used)\b/im.exec(body)?.[1]?.toLowerCase();
  const target = Number(/^\s*target:\s*\$?\s*([\d,.]+)/im.exec(body)?.[1]?.replace(/,/g, ''));
  if (!card || !condition || !(target > 0)) return null;
  const state = STATE_RE.exec(body)?.[1];
  return { card, condition, target, state: state ? JSON.parse(state) : null };
}

export function withState(body, state) {
  const marker = `<!-- watch-state ${JSON.stringify(state)} -->`;
  return STATE_RE.test(body) ? body.replace(STATE_RE, marker) : `${body.trimEnd()}\n\n${marker}`;
}

const money = (n) => `$${Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SOURCE = { retail: 'best US retail price', ebay: 'eBay', hardwaredeals: 'eBay listings snapshot' };

/**
 * Decide what to say for one watch. `quote` is the card's current price for the
 * watched condition ({ price, source, examples? }) or null.
 * Returns { comment: string | null, state }.
 */
export function evaluateWatch(watch, quote, cardName, siteUrl) {
  const { condition, target, state } = watch;
  const where = quote ? ` (${SOURCE[quote.source] ?? quote.source})` : '';
  const link = quote?.examples?.[0]?.url ? `\nCheapest matching listing: ${quote.examples[0].url}` : '';
  const footer = `\n\n${siteUrl}`;

  if (!quote || quote.price == null) {
    if (!state) {
      return { comment: `Watching ${cardName} (${condition}) for ${money(target)} or less. There's no reliable ${condition} price for it right now; I'll comment here once there is one at or below your target.${footer}`, state: { s: 'above' } };
    }
    return { comment: null, state };
  }

  const price = quote.price;
  const below = price <= target;
  if (!state) {
    return below
      ? { comment: `${cardName} (${condition}) is already ${money(price)}${where}, at or below your ${money(target)} target.${link}${footer}`, state: { s: 'below', p: price } }
      : { comment: `Watching ${cardName} (${condition}). It's ${money(price)}${where} right now. I'll comment here when it's ${money(target)} or less.${footer}`, state: { s: 'above' } };
  }
  if (state.s === 'above' && below) {
    return { comment: `${cardName} (${condition}) is now ${money(price)}${where}, at or below your ${money(target)} target.${link}${footer}`, state: { s: 'below', p: price } };
  }
  if (state.s === 'below' && below && price <= state.p * FURTHER_DROP) {
    return { comment: `${cardName} (${condition}) dropped further to ${money(price)}${where}.${link}${footer}`, state: { s: 'below', p: price } };
  }
  if (state.s === 'below' && !below) {
    return { comment: `${cardName} (${condition}) is back above your target at ${money(price)}${where}. I'll comment again if it drops to ${money(target)} or less.`, state: { s: 'above' } };
  }
  return { comment: null, state };
}
