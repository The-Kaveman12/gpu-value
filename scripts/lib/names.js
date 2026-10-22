// Match card names across sources ("GeForce RTX 5060 Ti 16GB" from Tom's
// Hardware vs "GeForce RTX 5060 Ti 16 GB" in the spec database).

/** Tom's Hardware names (benchmarks and price tracker) whose spec entry normalization can't find. */
export const BENCHMARK_ALIASES = {
  // Tom's Hardware tests the original 8GB GA106 card ($249 MSRP).
  'GeForce RTX 3050': 'GeForce RTX 3050 8 GB',
  // The price tracker lists the 8GB model ($399 MSRP) without a size.
  'GeForce RTX 4060 Ti': 'GeForce RTX 4060 Ti 8 GB',
  'Intel Arc A770 16GB': 'Arc A770',
};

/** Cards whose other memory sizes never reached retail, so listings needn't state VRAM. */
export const SINGLE_RETAIL_VRAM = new Set([
  'GeForce RTX 3080 Ti', // the 20 GB version was cancelled
]);

export function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/^(intel|nvidia|amd)\s+/, '')
    .replace(/(\d+)\s*gb\b/g, '$1 gb')
    .replace(/\s+/g, ' ')
    .trim();
}
