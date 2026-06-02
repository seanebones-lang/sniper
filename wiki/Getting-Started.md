# Getting Started

Paper mode is the default. Follow this guide to run Sniper locally and validate the UI before touching real money.

---

## Prerequisites

- **Node.js 20+**
- **PostgreSQL** (local Docker or Railway)
- Optional: **xAI API key** for Grok features

---

## 1. Clone and install

```bash
git clone https://github.com/seanebones-lang/sniper.git
cd sniper
npm install
cp .env.example .env.local
```

---

## 2. Database setup

### Docker (recommended locally)

```bash
docker run -d --name sniper-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=sniper \
  -p 5433:5432 postgres:16
```

Add to `.env.local`:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/sniper
```

Push schema:

```bash
npm run db:push
```

---

## 3. Start the dev server

```bash
npm run dev
```

Open **http://localhost:3000** (or the port Next.js prints if 3000 is taken).

---

## 4. First-run checklist

| Step | Route | What to do |
|------|-------|------------|
| 1 | `/settings` | Optionally add Grok (xAI) API key |
| 2 | `/strategies` | Create one or more strategies (paper-only by default) |
| 3 | `/strategies` | Start the 24/7 paper runner |
| 4 | `/markets` | Browse markets; open detail for order books (Polymarket/Kalshi WS) |
| 5 | `/dashboard` or `/paper` | View paper P&L, equity, realized/unrealized breakdown |
| 6 | `/backtest` | Historical replay after runner collects snapshots |
| 7 | `/health` | Risk mode, execution health, runner cycle timing |

The runner automatically evaluates strategies, inserts signals, and fills paper trades. Manual fills on market detail pages also work via `POST /api/paper/fill`.

---

## 5. Verify your install

```bash
npm run test:ci          # lint + build + unit (57 tests; no server needed)
npm run test:smoke       # 14 API checks (dev server must be running)
npm run test:e2e         # 14 Playwright specs (local: dev server on :3001)
npm run test:all         # full local suite
```

CI runs lint → build + unit → e2e with Postgres. Smoke tests are **not** in CI.

---

## 6. Optional: Grok research agent

1. Get an xAI API key from [console.x.ai](https://console.x.ai)
2. Add via **Settings** UI or set `XAI_API_KEY` in `.env.local`
3. Enable periodic runner analysis: `ENABLE_GROK_RESEARCH_AGENT=true`

Grok proposals and RECOMMENDED ACTIONS (pause, downweight) are parsed and can auto-apply.

---

## 7. Deploy to Railway (production)

See [Operations](Operations) for full deployment steps:

1. Connect repo → Railway auto-builds via `railway.toml`
2. Add Postgres plugin → set `DATABASE_URL`
3. Shell: `npm run db:push`
4. Set optional secrets from [Environment Variables](Environment-Variables)
5. Deploy → verify `/api/health`

---

## Next steps

- [UI Guide](UI-Guide) — walkthrough of every page
- [Strategies](Strategies) — configure trading rules
- [Project Status](Project-Status) — what works vs what doesn't
- [Contributing](Contributing) — fix remaining gaps and add features
