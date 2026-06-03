# Deploy Sniper on Railway (live Polymarket)

## Your deployment

| Item | Value |
|------|--------|
| Project | `sniper` (Railway dashboard) |
| URL | https://sniper-production-e817.up.railway.app |
| Region | `europe-west4` (Amsterdam) |
| Postgres | `Postgres` service (schema applied via `db:push`) |
| Strategy | Live Quick Flip (`12d5c973-71ce-46aa-8aee-2c52633fce6c`, live + active) |

## Critical: Railway EU ≠ EU egress for Polymarket

Deploying to `eu-west` on Railway **does not** guarantee a non-US outbound IP. Polymarket’s geoblock API still sees a **US** address from this host. Orders will be rejected until egress is in an [allowed country](https://docs.polymarket.com/developers/CLOB/geoblock).

**Fix:** set an HTTP(S) proxy in an allowed region (e.g. Ireland, Netherlands, UK is blocked — check docs):

```bash
railway variable set POLYMARKET_HTTP_PROXY='http://user:pass@your-eu-proxy:port' --service sniper
railway redeploy --service sniper --yes
```

Then verify:

```bash
curl -s https://sniper-production-e817.up.railway.app/api/polymarket/geoblock
# expect "blocked": false
```

Alternatives: Railway Pro **static outbound IPs** in EU (if your plan supports it), or a VPS in `eu-west-1` / Dublin with real EU egress.

## One-time setup (already done for this project)

```bash
railway init -n sniper
railway add --database postgres
railway service scale --service sniper eu-west=1 us-west=0 us-east=0
npx tsx scripts/railway-sync-env.ts --service sniper
railway variable set DATABASE_URL='${{Postgres.DATABASE_PUBLIC_URL}}' --service sniper
railway variable set SNIPER_AUTO_START_RUNNER=true NODE_ENV=production --service sniper
railway run --service sniper npm run db:push
railway run --service sniper npx tsx scripts/railway-bootstrap.ts
railway domain --service sniper
railway up --detach --service sniper
```

## Verify live trading

```bash
BASE=https://sniper-production-e817.up.railway.app
curl -s "$BASE/api/polymarket/geoblock"
curl -s -X POST "$BASE/api/real/setup"
curl -s "$BASE/api/real/status"
curl -s "$BASE/api/health"
```

Expect after proxy (or true EU egress): `geoblock.blocked: false`, `polymarketReady: true`, `runner.running: true`.

## Env vars (Railway → sniper service)

Synced from `.env.local` via `scripts/railway-sync-env.ts`. Required for live:

- `SNIPER_ENABLE_REAL_EXECUTION=true`
- `POLYMARKET_PRIVATE_KEY`, `POLYMARKET_SIGNATURE_TYPE=3`, `POLYMARKET_FUNDER_ADDRESS`
- `POLYMARKET_API_*` or runtime derive
- `RELAYER_API_KEY`, `RELAYER_API_KEY_ADDRESS`
- `DATABASE_URL` → `${{Postgres.DATABASE_PUBLIC_URL}}`
- `SNIPER_AUTO_START_RUNNER=false` — paper only; **live mode ignores this** and uses `runner_control` (auto-starts unless you stop from UI)
- `POLYMARKET_HTTP_PROXY` — **required on Railway until egress is non-US**

Do **not** set `SNIPER_SKIP_GEOBLOCK_CHECK` in production.

## Redeploy after code changes

```bash
npm run build   # local sanity check
railway up --detach --service sniper
```
