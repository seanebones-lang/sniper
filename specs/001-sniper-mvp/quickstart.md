# Quickstart — Running Sniper (Paper Mode 24/7)

**Updated:** June 2, 2026. **Status:** [docs/STATUS.md](../../docs/STATUS.md).

## 1. Environment

```bash
cp .env.example .env.local
npm install
npm run db:push
```

## 2. Run locally

```bash
npm run dev
# http://localhost:3000
```

## 3. Configure (optional)

- `/settings` — Grok API key + research agent toggle

## 4. Create strategies & start runner

1. Open `/strategies` — create 1–2 strategies (paper-only default)
2. Open `/paper` — set budget, **Start runner**
3. Watch `/dashboard` for live P&L and portfolio

## 5. Observe

- `/dashboard` — live equity, P&L, runner status
- `/markets` — discovery; detail pages for manual fills + WS
- `/health` — risk mode, execution quality, cycle timing
- `/backtest` — replay after snapshots accumulate

## 6. Test

```bash
npm run test:ci          # lint + build + 57 unit tests
npm run test:smoke       # needs dev server
npx tsx scripts/diagnose-paper-pnl.ts  # P&L regression check
```

## 7. Deploy (Railway)

1. Postgres plugin → `DATABASE_URL`
2. Shell: `npm run db:push`
3. Set secrets from `.env.example`
4. Redeploy

Real execution remains opt-in — see [docs/STATUS.md](../../docs/STATUS.md).
