// Check site/data/prices.json and keep one GitHub issue (label "data-health")
// in sync with the result: open it when something breaks, comment when the
// problems change, close it when everything recovers. GitHub emails the repo
// owner about new issues and comments.
//
// Without GITHUB_TOKEN / GITHUB_REPOSITORY it only prints the report.
//
//   node scripts/report-health.mjs

import { readFile } from 'node:fs/promises';
import { fingerprint, healthProblems } from './lib/health.js';

const LABEL = 'data-health';
const TITLE = 'Price data needs attention';
const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_SERVER_URL: server = 'https://github.com', GITHUB_RUN_ID: runId } = process.env;

let doc = null;
try {
  doc = JSON.parse(await readFile(new URL('../site/data/prices.json', import.meta.url), 'utf8'));
} catch {
  // healthProblems reports the missing file.
}
const problems = healthProblems(doc);
if (process.env.HEALTH_TEST_ALERT === 'true') problems.push('Test alert requested from the Actions tab. Not a real problem; the next normal run closes this.');
const mark = `<!-- health:${fingerprint(problems)} -->`;
console.log(problems.length ? `Problems:\n- ${problems.join('\n- ')}` : 'All price sources healthy.');

if (!token || !repo) process.exit(0);

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 422) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const runLink = runId ? `\n\n[Workflow run](${server}/${repo}/actions/runs/${runId})` : '';
const list = problems.map((p) => `- ${p}`).join('\n');
const [issue] = await gh('GET', `/issues?labels=${LABEL}&state=open&per_page=1`);

if (problems.length) {
  if (!issue) {
    await gh('POST', '/labels', { name: LABEL, color: 'd93f0b', description: 'Automated price data health alerts' }); // 422 if it exists
    const created = await gh('POST', '/issues', {
      title: TITLE,
      labels: [LABEL],
      body: `The scheduled price update found problems:\n\n${list}${runLink}\n\nThis issue closes itself once the data is healthy again.\n${mark}`,
    });
    console.log(`Opened issue #${created.number}.`);
  } else if (!issue.body?.includes(mark)) {
    await gh('POST', `/issues/${issue.number}/comments`, { body: `The problems changed:\n\n${list}${runLink}` });
    await gh('PATCH', `/issues/${issue.number}`, { body: issue.body.replace(/<!-- health:[0-9a-f]+ -->/, '') + `\n${mark}` });
    console.log(`Updated issue #${issue.number}.`);
  } else {
    console.log(`Issue #${issue.number} already describes these problems.`);
  }
} else if (issue) {
  await gh('POST', `/issues/${issue.number}/comments`, { body: `All price sources are healthy again.${runLink}` });
  await gh('PATCH', `/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' });
  console.log(`Closed issue #${issue.number}.`);
}
