// Add a version to the page's script/style URLs so browsers never pair a new
// index.html with cached old modules (GitHub Pages caches files for 10 min).
// Every relative import in every site/*.js gets the version, so modules that
// import each other stay in step too. Run in CI just before upload; it
// rewrites files in site/ in place.
//
//   node scripts/stamp-version.mjs [version]   (default: $GITHUB_SHA or a timestamp)

import { readdir, readFile, writeFile } from 'node:fs/promises';

const version = (process.argv[2] ?? process.env.GITHUB_SHA ?? Date.now().toString(36)).slice(0, 10);
const site = (f) => new URL(`../site/${f}`, import.meta.url);

let html = await readFile(site('index.html'), 'utf8');
for (const [from, to] of [['href="styles.css"', `href="styles.css?v=${version}"`], ['src="app.js"', `src="app.js?v=${version}"`]]) {
  if (!html.includes(from)) throw new Error(`index.html: expected to find ${from}`);
  html = html.replaceAll(from, to);
}
await writeFile(site('index.html'), html);

let count = 0;
for (const file of (await readdir(site(''))).filter((f) => f.endsWith('.js'))) {
  const text = await readFile(site(file), 'utf8');
  const stamped = text.replace(/(from\s+'\.\/[\w-]+\.js)'/g, (_, path) => {
    count++;
    return `${path}?v=${version}'`;
  });
  await writeFile(site(file), stamped);
}
console.log(`Stamped site assets with version ${version} (${count} module imports).`);
