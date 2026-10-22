// Parse the raster and ray-tracing tables out of Tom's Hardware's GPU
// Benchmarks Hierarchy page.

const text = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const RESOLUTIONS = { '1080p ultra': '1080p', '1440p ultra': '1440p', '4k ultra': '4k' };

function parseCell(cell) {
  // e.g. "69.7% (116.5)"
  const m = /([\d.]+)%\s*\(([\d.]+)\)/.exec(cell);
  return m ? { pct: Number(m[1]), fps: Number(m[2]) } : null;
}

function parseTable(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) =>
    [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => text(c[1])),
  );
  const header = rows[0].map((h) => h.toLowerCase());
  const nameCol = header.findIndex((h) => h.includes('graphics card'));
  const msrpCol = header.findIndex((h) => h.includes('msrp'));
  const resCols = header.map((h, i) => [RESOLUTIONS[h], i]).filter(([r]) => r);
  if (nameCol < 0 || resCols.length === 0) throw new Error(`Unexpected table header: ${rows[0].join(' | ')}`);

  return rows.slice(1).map((cells) => {
    const row = { card: cells[nameCol], msrp: Number(cells[msrpCol]?.replace(/[$,]/g, '')) || null };
    for (const [res, i] of resCols) row[res] = parseCell(cells[i]);
    return row;
  });
}

const dollars = (s) => {
  const m = /\$\s*([\d,]+(?:\.\d+)?)/.exec(s ?? '');
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

/**
 * Parse Tom's Hardware's "Lowest GPU prices" tracker. Returns
 * { updated: ISO timestamp | null, rows: [{ card, price, lowestEver, msrp, outOfStock }] }.
 * `price` is the best current US retail price for a new card, or null when out of stock.
 */
export function parsePriceTracker(html) {
  const rows = [];
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const cells = [...m[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) =>
      [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => text(c[1])),
    );
    const header = (cells[0] ?? []).map((h) => h.toLowerCase());
    const col = (re) => header.findIndex((h) => re.test(h));
    const [name, best, lowest, msrp] = [col(/gpu|model|card/), col(/best .*price/), col(/lowest/), col(/msrp/)];
    if (name < 0 || best < 0) continue;
    for (const r of cells.slice(1)) {
      if (!r[name]) continue;
      rows.push({
        card: r[name],
        price: dollars(r[best]),
        lowestEver: lowest >= 0 ? dollars(r[lowest]) : null,
        msrp: msrp >= 0 ? dollars(r[msrp]) : null,
        outOfStock: /out of stock/i.test(r[best]),
      });
    }
  }
  if (rows.length === 0) throw new Error('No price tables found on the Tom\'s Hardware tracker page.');
  const updated = /"dateModified":\s*"([^"]+)"/.exec(html)?.[1] ?? null;
  return { updated, rows };
}

/** Returns { updated: 'YYYY-MM-DD' | null, tables: { raster: [...], rt: [...] } }. */
export function parseHierarchy(html) {
  const tables = {};
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const before = html.slice(Math.max(0, m.index - 3000), m.index);
    const heading = [...before.matchAll(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/g)].map((h) => text(h[1])).pop() ?? '';
    if (/ray tracing/i.test(heading)) tables.rt ??= parseTable(m[0]);
    else if (/rasterization/i.test(heading)) tables.raster ??= parseTable(m[0]);
  }
  if (!tables.raster || !tables.rt) throw new Error('Could not find both the rasterization and ray tracing tables.');
  const updated = /"dateModified":\s*"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1] ?? null;
  return { updated, tables };
}
