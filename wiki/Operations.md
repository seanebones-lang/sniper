# Operations

How to run Sniper 24/7, monitor health, and deploy safely.

---

## Recommended setup

| Component | Purpose |
|-----------|---------|
| **Railway** | Always-on hosting (hobby or pro tier) |
| **PostgreSQL** | Railway plugin → `DATABASE_URL` |
| **Telegram bot** | Alerts (strongly recommended) |
| **Grok API key** | Settings UI or `XAI_API_KEY` env var |

---

## Local development

```bash
cp .env.example .env.local
npm run db:push
npm run dev
```

Default URL: `http://localhost:3000`. If occupied, use `-p 3001` and set `SMOKE_BASE_URL` / `PLAYWRIGHT_BASE_URL` accordingly.

---

## CI / quality gates

CI (`.github/workflows/ci.yml`):

1. **ESLint** — zero issues required
2. **Build + unit tests** — 57 Vitest tests
3. **E2E** — Playwright with Postgres; builds app on port 3010

**Not in CI:** smoke tests (`scripts/smoke-test.mjs`). Run locally with dev server.

E2E may call live Polymarket APIs — can be flaky when external services are down.

---

## Daily / weekly routine

1. Check Telegram alerts and `/health` dashboard
2. Review unhealthy markets flagged by the runner
3. Trigger Grok analysis on underperforming strategies
4. Review proposals; test via variants + historical replay
5. Export audit events periodically *(export UI not built — query DB directly)*

---

## Monitoring endpoints

| Endpoint | Purpose |
|----------|---------|
| `/health` | Risk mode, restrictions, execution health, Grok recs |
| `/api/health` | JSON version of health data |
| `/api/runner` | Runner status (running, last run, fill counts) |
| `/api/research/performance` | Recent attribution |
| `/api/research/proposals` | Recent Grok proposals |

**Watch for:**

- Risk mode entering DEFENSIVE or EMERGENCY
- Unhealthy markets count increasing
- Grok recommendations pending vs applied
- Active temporary adjustments

---

## Kill switches

| Action | Method |
|--------|--------|
| Stop runner | Strategies page → Stop (`POST /api/runner`) |
| Per-strategy pause | Toggle `isActive` on Strategies page |
| Real execution | Leave `SNIPER_ENABLE_REAL_EXECUTION` unset or `false` |
| Emergency | Stop runner + disable real env flag |

---

## Deployment (Railway)

1. Connect repo → Railway auto-builds via `railway.toml`
2. Add Postgres → copy `DATABASE_URL` to service variables
3. Shell: `npm run db:push`
4. Set optional secrets from [Environment Variables](Environment-Variables)
5. Deploy → verify `/api/health`

Healthcheck hits `/` with 120s timeout (see `railway.toml`).

---

## Real money checklist

Only after **48–72+ hours** of paper soak with acceptable execution quality:

1. Set `SNIPER_ENABLE_REAL_EXECUTION=true`
2. Set `POLYMARKET_PRIVATE_KEY` (dedicated low-balance wallet)
3. Create strategy with `paperOnly: false` *(via DB or future UI)*
4. Enable Telegram alerts
5. Monitor `/health` continuously for first sessions
6. Start with minimum size configs (`maxSizeUsd: 50–100`)

---

## Settings & secrets

| Secret | Where | Notes |
|--------|-------|-------|
| `DATABASE_URL` | env only | Required |
| `XAI_API_KEY` | env **or** Settings UI | UI stores in `data/user-settings.json` (gitignored) |
| `ENABLE_GROK_RESEARCH_AGENT` | env **or** Settings UI | Periodic runner analysis |
| `POLYMARKET_PRIVATE_KEY` | env only | Real trading; never in browser |
| `SNIPER_ENABLE_REAL_EXECUTION` | env only | Must be `true` for real orders |
| Telegram tokens | env only | Optional alerts |

**Never** put real trading keys in code or commit them.

---

## Related pages

- [Getting Started](Getting-Started)
- [Environment Variables](Environment-Variables)
- [Risk Management](Risk-Management)
