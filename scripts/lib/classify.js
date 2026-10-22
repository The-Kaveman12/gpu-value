// Classify an entry from the TechPowerUp-derived spec database into a market
// segment. Only "desktop" and "workstation" cards are published on the site.

const RULES = [
  ['console', /console/i],
  ['datacenter', /tesla|server|instinct|data center|\bgrid\b|\bdrive\b|knights|mining|arctic sound|ponte vecchio|firepro (server|data center|remote)|firestream|\bh3c\b/i],
  ['integrated', /igp|graphics-|hd graphics|\bgma\b|xe graphics|arc graphics|tegra|extreme graphics|all-in-one|\bion\b|^graphics/i],
  ['mobile', /mobile|max-q|\bgo\b|laptop|mobility|gem system|vancouver|london|solar system|-mw\b|-m\b|embedded|\d+m\b|\(.*\d+m\)|\d00a$|\bmx\b|geforce mx|vega m|radeon pro mac|\btim\b/i],
  ['workstation', /quadro|firepro|firegl|fire gl|radeon pro|workstation|blackwell pro|pro series|\bnvs\b|firemv|\brtx a\d|\brtx \d+ ada|\brtx pro\b|matrox qid|ampere-mw/i],
];

/** Returns 'desktop' | 'workstation' | 'mobile' | 'integrated' | 'datacenter' | 'console'. */
export function classify(gpu) {
  for (const [segment, re] of RULES) {
    if (re.test(gpu.name) || re.test(gpu.generation ?? '')) return segment;
  }
  return 'desktop';
}

export const PUBLISHED_SEGMENTS = new Set(['desktop', 'workstation']);
