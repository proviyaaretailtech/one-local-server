# Load test for the One Local API

Plain Node scripts, no dependencies (k6 and autocannon were not installed). Report of the first run: `agent/reports/load-test-2026-10-14.md` in the workspace repo.

| File | What it does |
|---|---|
| `serve-prod.cjs` | Serves the production build (`dist/server`) on a local port with the same handler Vercel runs (`api/index.js`). |
| `load-test.mjs` | `setup`, `run`, `saturate`, `probe`, `hosted`, `cleanup` (see the header of the file for the flags). |
| `cleanup.sql` | Removes the test users and everything made for them (used by `cleanup`). |

## Run it on the local stack

```bash
cd frontend
npx expo export -p web                         # production build into dist/
set -a; . ./.env.local; set +a                 # local Supabase on OrbStack
NODE_ENV=production PORT=8201 node scripts/load/serve-prod.cjs &
node scripts/load/load-test.mjs setup   --customers 180 --riders 16 --partners 4 --fixtures /tmp/ol-fixtures.json
node scripts/load/load-test.mjs run     --fixtures /tmp/ol-fixtures.json --stages 10,50,200 --duration 45 --pid $! --out /tmp/run.json
node scripts/load/load-test.mjs saturate --paths /api/catalog,/api/stores --connections 50,200,500
node scripts/load/load-test.mjs probe   --fixtures /tmp/ol-fixtures.json      # add --base2 for a second server (port 8202) to see the many-instances effect
node scripts/load/load-test.mjs cleanup
```

Before a run, make sure the Demo Spice restaurant is accepting orders (`ol_merchant_channels.accepting = true`, `missed_in_a_row = 0`); it pauses itself after 3 unanswered orders, and the `run` command's partner screens answer orders to prevent that.

## Safety

- `setup`, `run`, `probe` and `cleanup` refuse any database that is not on 127.0.0.1 / localhost.
- The HTTP helper refuses any non-GET request to a host that is not loopback. `hosted` sends GET requests only, at most 5 a second, and only to routes that never write (the rate-limited routes write a counter row, so they are not used).
- Test users are `zz-load-*@example.test`; `database/purge_test_orders.sh` also removes `zz-%@example.test`. `cleanup` removes the users, their orders, checkouts, delivery rows, rider and partner rows and the rate-limit counters.
- Secrets are read from the env file and never printed or written to result files.
