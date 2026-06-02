# Quickstart — Running Sniper (Paper Mode 24/7)

**Updated:** June 2026. **Status:** [docs/STATUS.md](../../docs/STATUS.md). See [README.md](../../README.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).

## 1. Environment

```bash
cp .env.example .env.local
# Edit DATABASE_URL — see README for Docker Postgres example
npm install
npm run db:push
```

## 2. Run locally

```bash
npm run dev
# http://localhost:3000 (or -p 3001 if busy)
```

## 3. Configure (optional)

- `/settings` — Grok API key + research agent toggle

## 4. Create strategies

1. Open `/strategies`
2. Create 1–2 strategies on liquid short-term markets (paper-only default)
3. Start the runner

## 5. Observe

- `/markets` — discovery + last prices
- `/markets/polymarket/[tokenId]` — order book, manual paper fill
- `/health` — risk mode + execution quality
- `/backtest` — replay after snapshots accumulate

## 6. Test before contributing

```bash
npm run test:ci          # lint + build + unit
npm run test:smoke       # needs dev server
```

## 7. Deploy (Railway)

1. Connect repo, add Postgres plugin
2. Set `DATABASE_URL` and optional secrets (`.env.example`)
3. Shell: `npm run db:push`
4. Redeploy

## 48-Hour Soak

Before any real money — see README checklist and [docs/OPERATIONS.md](../../docs/OPERATIONS.md).

## Spec References

- [data-model.md](./data-model.md) — entities (see `lib/db/schema.ts` for truth)
- [research.md](./research.md) — Polymarket/Kalshi API notes
