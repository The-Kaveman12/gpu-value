// Check every open "price-watch" issue against the latest prices, comment when
// something changes, and write site/data/alerts.json so the page can show
// which cards have alerts.
//
// Needs GITHUB_TOKEN and GITHUB_REPOSITORY; without them it writes an empty list.
//
//   node scripts/check-watches.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { evaluateWatch, parseWatch, WATCH_LABEL, withState } from './lib/watch.js';

const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
const OUT = 'site/data/alerts.json';

if (!token || !repo) {
  await writeFile(OUT, '[]');
  console.log('No GitHub token: skipped price alerts.');
  process.exit(0);
}

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const prices = JSON.parse(await readFile('site/data/prices.json', 'utf8'));
const { gpus } = JSON.parse(await readFile('site/data/gpus.json', 'utf8'));
const names = new Map(gpus.map((g) => [g.id, g.name]));
const [owner, name] = repo.split('/');
const siteUrl = `https://${owner.toLowerCase()}.github.io/${name}/`;

const issues = (await gh('GET', `/issues?labels=${WATCH_LABEL}&state=open&per_page=100`)).filter((i) => !i.pull_request);
const alerts = [];

for (const issue of issues) {
  const watch = parseWatch(issue.body ?? '');
  if (!watch || !names.has(watch.card)) {
    if (!/<!-- watch-invalid -->/.test(issue.body ?? '')) {
      await gh('POST', `/issues/${issue.number}/comments`, {
        body: 'I couldn\'t read this alert. The issue body needs three lines like:\n\n```\ncard: amd-radeon-rx-9070-xt\ncondition: new\ntarget: 700\n```\n\nThe easiest way to get them right is the "Create alert" button on a card\'s details on the site.',
      });
      await gh('PATCH', `/issues/${issue.number}`, { body: `${(issue.body ?? '').trimEnd()}\n\n<!-- watch-invalid -->` });
    }
    continue;
  }

  const quote = prices.cards?.[watch.card]?.[watch.condition] ?? null;
  const { comment, state } = evaluateWatch(watch, quote, names.get(watch.card), siteUrl);
  if (comment) await gh('POST', `/issues/${issue.number}/comments`, { body: comment });
  if (JSON.stringify(state) !== JSON.stringify(watch.state)) {
    await gh('PATCH', `/issues/${issue.number}`, { body: withState(issue.body ?? '', state) });
  }
  alerts.push({ number: issue.number, url: issue.html_url, card: watch.card, condition: watch.condition, target: watch.target, below: state.s === 'below' });
  console.log(`#${issue.number} ${names.get(watch.card)} ${watch.condition} <= ${watch.target}: ${state.s}${comment ? ' (commented)' : ''}`);
}

await writeFile(OUT, JSON.stringify(alerts));
console.log(`${alerts.length} active price alert(s).`);
