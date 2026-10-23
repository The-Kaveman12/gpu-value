# Price history

Daily prices for the GPU Value site, one point per card per day, written by the
"Refresh prices and deploy" workflow on `main`. Don't edit by hand.

`history.json`: `{ updated, days: ["YYYY-MM-DD", ...], cards: { "<gpu id>": { "n": [new prices], "u": [used prices] } } }`,
with `null` where no fresh price existed that day.

Days before 2026-10-22 were rebuilt from archived sources (`scripts/backfill-history.mjs`):
Wayback Machine copies of Tom's Hardware's GPU price tracker and HardwareDeals.co's daily eBay snapshots.
