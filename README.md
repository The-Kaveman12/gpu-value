# GPU Value

A searchable catalog of every desktop graphics card with full specs, ranked by **real gaming performance per dollar** using live market prices.

- **Specs** for ~1,275 desktop and workstation GPUs come from the [TechPowerUp GPU Database](https://www.techpowerup.com/gpu-specs/), via the open [RightNow GPU Database](https://github.com/RightNow-AI/RightNow-GPU-Database) (Apache-2.0).
- **Performance** comes from real game benchmarks in [Tom's Hardware's GPU Benchmarks Hierarchy](https://www.tomshardware.com/reviews/gpu-hierarchy,4388.html): average fps at 1080p, 1440p and 4K, raster and ray tracing.
- **Prices** are refreshed every 6 hours by GitHub Actions from three sources:
  - **New:** the best current US retail price from [Tom's Hardware's GPU price tracker](https://www.tomshardware.com/pc-components/gpus/lowest-gpu-prices-tracking), or live eBay listings if they're cheaper.
  - **Used:** the [eBay Browse API](https://developer.ebay.com/api-docs/buy/browse/overview.html), falling back to [HardwareDeals.co's daily eBay snapshot](https://github.com/HardwareDealsCo/gpu-deals) (MIT) until the API key is set.
  - Each eBay price is the median of the 5 cheapest exact-model listings, and at least 3 matches are required. Every quote keeps its source and date, and stale quotes are flagged on the page.

**Value = average FPS ÷ price × 100** (frames per second per $100). You can switch resolution, raster/ray tracing/mixed, and new/used/MSRP pricing in the page.

## Setup: live prices

Prices need a free eBay developer key:

1. Sign up at <https://developer.ebay.com/> and create an application keyset (**Production**).
2. In this repo, go to **Settings → Secrets and variables → Actions** and add:
   - `EBAY_CLIENT_ID`: the App ID (Client ID)
   - `EBAY_CLIENT_SECRET`: the Cert ID (Client Secret)
3. Go to **Actions → Refresh prices and deploy → Run workflow**.

Until the keys are added, new prices come from the retail tracker and used prices from the daily eBay snapshot.

## Monitoring

- **Health alerts:** after every price update, `scripts/report-health.mjs` checks for stale sources, a drop in how many cards have prices, and new tracker cards that don't match the spec database. Problems open a GitHub issue labeled `data-health` (GitHub emails you). The issue is updated when the problems change and closes itself when the data recovers. Crashed scheduled runs are noted on the same issue.
- **Test it:** go to **Actions → Refresh prices and deploy → Run workflow** and tick "Send a test health alert". The next normal run closes the test issue.
- **Keep-alive:** GitHub pauses scheduled workflows after 60 days without repository activity. If the repo has had no commits for 45 days, the scheduled run commits a date to `.github/keepalive`. Run `git pull` before pushing if that has happened.

## Development

Requires Node 22+ and has no dependencies.

```sh
npm test                    # builds site/data/gpus.json, then runs the tests
npm run serve               # preview at http://localhost:8080
EBAY_CLIENT_ID=… EBAY_CLIENT_SECRET=… npm run prices   # fetch prices locally
npm run update:specs        # re-download the spec database → data/specs.json
npm run update:benchmarks   # re-fetch Tom's Hardware tables → data/benchmarks.json
```

| Path | What |
|---|---|
| `site/` | The static page (`index.html`, `app.js`, `logic.js`, `styles.css`). `site/data/` is generated. |
| `data/specs.json`, `data/benchmarks.json` | Committed source snapshots, each with its source URL and date |
| `scripts/` | Importers, the eBay price fetcher, the site builder and a dev server |
| `.github/workflows/deploy.yml` | Every 6 h and on each push: test, fetch prices, deploy to GitHub Pages |

Scheduled workflows on GitHub pause after 60 days without repository activity. Re-enable them from the Actions tab if prices stop updating; the site shows a "stale" banner when that happens.
