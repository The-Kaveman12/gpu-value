import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateWatch, parseWatch, withState } from '../scripts/lib/watch.js';

const SITE = 'https://example.github.io/gpu-value/';
const body = 'card: amd-radeon-rx-9070-xt\ncondition: new\ntarget: 700\n\nCreated from GPU Value.';

test('parseWatch reads the three fields and the hidden state', () => {
  assert.deepEqual(parseWatch(body), { card: 'amd-radeon-rx-9070-xt', condition: 'new', target: 700, state: null });
  assert.equal(parseWatch('card: x\ncondition: New\ntarget: $1,250').target, 1250);
  assert.equal(parseWatch('card: x\ntarget: 700'), null); // no condition
  assert.equal(parseWatch('hello'), null);
  const withMark = withState(body, { s: 'below', p: 679 });
  assert.deepEqual(parseWatch(withMark).state, { s: 'below', p: 679 });
  assert.deepEqual(parseWatch(withState(withMark, { s: 'above' })).state, { s: 'above' }); // replaced, not duplicated
  assert.equal(withState(withMark, { s: 'above' }).match(/watch-state/g).length, 1);
});

const watch = (state) => ({ card: 'c', condition: 'new', target: 700, state });
const quote = (price) => ({ price, source: 'retail' });

test('first check confirms the alert, or fires at once if already under target', () => {
  const ack = evaluateWatch(watch(null), quote(829), 'RX 9070 XT', SITE);
  assert.match(ack.comment, /^Watching RX 9070 XT \(new\)\. It's \$829 \(best US retail price\) right now\. I'll comment here when it's \$700 or less\./);
  assert.deepEqual(ack.state, { s: 'above' });
  const hit = evaluateWatch(watch(null), quote(690), 'RX 9070 XT', SITE);
  assert.match(hit.comment, /already \$690/);
  assert.deepEqual(hit.state, { s: 'below', p: 690 });
  const none = evaluateWatch(watch(null), null, 'RX 9070 XT', SITE);
  assert.match(none.comment, /no reliable new price/);
});

test('comments only on changes: reaching target, dropping 3%+ further, recovering', () => {
  assert.equal(evaluateWatch(watch({ s: 'above' }), quote(750), 'X', SITE).comment, null);
  const hit = evaluateWatch(watch({ s: 'above' }), quote(699), 'X', SITE);
  assert.match(hit.comment, /is now \$699 .*at or below your \$700 target/);
  assert.equal(evaluateWatch(watch({ s: 'below', p: 699 }), quote(690), 'X', SITE).comment, null); // < 3% lower
  assert.match(evaluateWatch(watch({ s: 'below', p: 699 }), quote(670), 'X', SITE).comment, /dropped further to \$670/);
  const back = evaluateWatch(watch({ s: 'below', p: 670 }), quote(720), 'X', SITE);
  assert.match(back.comment, /back above your target at \$720/);
  assert.deepEqual(back.state, { s: 'above' });
  assert.equal(evaluateWatch(watch({ s: 'below', p: 670 }), null, 'X', SITE).comment, null); // price vanished: stay quiet
});

test('alert comments link to the cheapest listing when there is one', () => {
  const q = { price: 650, source: 'hardwaredeals', examples: [{ url: 'https://www.ebay.com/itm/1' }] };
  assert.match(evaluateWatch(watch({ s: 'above' }), q, 'X', SITE).comment, /Cheapest matching listing: https:\/\/www\.ebay\.com\/itm\/1/);
});
