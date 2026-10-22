// Add a version to the page's script/style URLs so browsers never pair a new
// index.html with a cached old app.js (GitHub Pages caches files for 10 min).
// Run in CI just before upload; it rewrites files in site/ in place.
//
//   node scripts/stamp-version.mjs [version]   (default: $GITHUB_SHA or a timestamp)

import { readFile, writeFile } from 'node:fs/promises';

const version = (process.argv[2] ?? process.env.GITHUB_SHA ?? Date.now().toString(36)).slice(0, 10);
const site = (f) => new URL(`../site/${f}`, import.meta.url);

const rewrite = async (file, pairs) => {
  let text = await readFile(site(file), 'utf8');
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`${file}: expected to find ${from}`);
    text = text.replaceAll(from, to);
  }
  await writeFile(site(file), text);
};

await rewrite('index.html', [
  ['href="styles.css"', `href="styles.css?v=${version}"`],
  ['src="app.js"', `src="app.js?v=${version}"`],
]);
await rewrite('app.js', [["from './logic.js'", `from './logic.js?v=${version}'`]]);
console.log(`Stamped site assets with version ${version}.`);
