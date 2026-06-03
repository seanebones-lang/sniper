# Sniper.

**A research-first automated trading platform for Polymarket and Kalshi.**

Designed for small, consistent edges over long periods — not gambling or home runs.

> **High risk personal tool.** Most automated prediction market strategies lose money after fees, slippage, and adverse selection. You can lose all capital. Paper mode is strongly recommended for extended periods before any real money.

## Live demo (June 2026)

Paper trading runner, live P&L ledger, and dashboard in action (15s preview — click for full video):

[![Paper trading demo — click to watch full video](docs/demo/sniper-paper-trading-demo.gif)](https://github.com/seanebones-lang/sniper/blob/main/docs/demo/sniper-paper-trading-demo.mov)

**[▶ Watch full demo video](https://github.com/seanebones-lang/sniper/blob/main/docs/demo/sniper-paper-trading-demo.mov)** (35 MB, ~1 min)

## What this is (and is not)

**Sniper is:**

- A market discovery and order book research UI (Polymarket + Kalshi)
- A paper-trading simulator with manual **and automated** fill paths
- A 24/7 runner that collects order book snapshots and evaluates strategies
- Accurate paper P&L via cash ledger + live mark-to-market
- A backtesting lab with synthetic and historical replay
- An optional Grok (xAI) research layer for analysis and recommendations
- An optional, heavily gated real execution path for Polymarket and Kalshi

**Sniper is not (today):**

- A production-ready unattended real-money bot — see [Critical blockers](docs/STATUS.md#critical-blockers)
- A cross-venue arbitrage engine

**Authoritative status:** [docs/STATUS.md](docs/STATUS.md) — capability matrix verified against code.

**Wiki:** [GitHub Wiki](https://github.com/seanebones-lang/sniper/wiki) · source in [`wiki/`](wiki/) (run `./wiki/sync-to-github.sh` to publish)

## Screenshots

Local dev UI (June 2026). Paper mode is the default throughout.

| Landing | Dashboard |
|:---:|:---:|
| ![Landing page](docs/screenshots/landing.png) | ![Dashboard](docs/screenshots/dashboard.png) |

| Strategies | Create strategy |
|:---:|:---:|
| ![Strategies list and runner control](docs/screenshots/strategies.png) | ![Create strategy form](docs/screenshots/strategies-create.png) |

| Backtest lab | Strategy health |
|:---:|:---:|
| ![Research and backtesting lab](docs/screenshots/backtest.png) | ![Strategy health dashboard](docs/screenshots/health.png) |

| Real execution gate |
|:---:|
| ![Real money execution confirmation](docs/screenshots/real-execution.png) |

## Core Philosophy

- **Paper mode is sacred** — the default and primary way to operate.
- **Self-protection first** — risk modes, circuit breakers, and execution health throttle sizing.
- **Research flywheel** — snapshot collection → analysis → recommendations → replay validation.
- **Execution quality matters** — adverse selection and poor fills destroy edges.
- **Auditable everything** — decisions traced via `audit_events` and signal reasons.

## What works today

Verified against the codebase (June 2, 2026):

| Area | Status |
|------|--------|
| Polymarket + Kalshi market discovery and order books (REST) | Works |
| Manual + automated paper fills → `paper_trades` | Works |
| Paper P&L (ledger + MTM) on dashboard and `/paper` | Works |
| Five strategy types + create/toggle via UI | Works |
| Runner loop (book cache, adaptive interval, risk-unified sizing) | Works |
| Grok intel + research agent + auto-apply actions | Works (requires xAI key) |
| Per-strategy PnL attribution + PnL-weighted allocator | Works |
| Historical snapshot replay | Works (needs runner soak first) |
| Real Polymarket / Kalshi execution | Coded, gated, not CI-tested |
| CI (lint, build, 57 unit tests, e2e) | GitHub Actions |

Full matrix: [docs/STATUS.md](docs/STATUS.md).

## Quickstart (Paper Recommended)

### Prerequisites

- Node.js 20+
- PostgreSQL (local Docker or Railway)

### Local setup

```bash
git clone https://github.com/seanebones-lang/sniper.git
cd sniper
cp .env.example .env.local
npm install
npm run db:push
npm run dev
```

Open **http://localhost:3000** (or the port Next.js prints if 3000 is taken).

### First run checklist

1. **Settings** (`/settings`) — optionally add Grok (xAI) API key.
2. **Strategies** (`/strategies`) — create strategies (paper-only by default).
3. **Paper Portfolio** (`/paper`) — set budget, start the runner.
4. **Dashboard** (`/dashboard`) — live P&L, equity, and runner status.
5. **Markets** (`/markets`) — order books; manual paper fill on detail pages.
6. **Backtest** (`/backtest`) — historical replay after snapshots accumulate.
7. **Health** (`/health`) — risk mode, execution health, runner cycle timing.

### Local Postgres via Docker

```bash
docker run -d --name sniper-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=sniper \
  -p 5433:5432 postgres:16
```

Set `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/sniper` in `.env.local`.

## Testing

```bash
npm run lint          # ESLint (enforced in CI)
npm run test          # Vitest — 57 unit tests
npm run test:ci       # lint + build + unit
npm run test:smoke    # 14 API checks (requires dev server)
npm run test:e2e      # Playwright specs
npm run test:all      # lint + unit + smoke + e2e
```

CI (`.github/workflows/ci.yml`): lint → build + unit → e2e with Postgres.

## UI & API

| Route | Purpose |
|-------|---------|
| `/` | Landing |
| `/dashboard` | Live paper P&L + portfolio + system status |
| `/paper` | Full portfolio, budget, runner control |
| `/markets` | Market discovery |
| `/markets/[platform]/[id]` | Order book, manual paper fill, Grok intel, WS |
| `/strategies` | Strategies + runner control |
| `/backtest` | Synthetic + historical replay, Grok lab |
| `/settings` | Grok API key + research agent toggle |
| `/health` | Risk mode, execution health, runner timing |
| `/real` | Real execution warnings (placeholder status UI) |

API reference: [docs/STATUS.md#api-routes](docs/STATUS.md#api-routes).

## Documentation

| Doc | Description |
|-----|-------------|
| [Wiki (GitHub)](https://github.com/seanebones-lang/sniper/wiki) | Full documentation — source in [`wiki/`](wiki/) |
| [docs/STATUS.md](docs/STATUS.md) | **Authoritative capability matrix and blockers** |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute; dev setup |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design |
| [docs/STRATEGIES.md](docs/STRATEGIES.md) | Strategy types and config |
| [docs/RISK.md](docs/RISK.md) | Risk layers |
| [docs/EXECUTION.md](docs/EXECUTION.md) | Execution layer |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Research flywheel |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | 24/7 ops and CI |
| [FEATURES.md](FEATURES.md) | Standout capabilities |
| [specs/001-sniper-mvp/](specs/001-sniper-mvp/) | Original MVP spec |

## MVP Phases

| Phase | Scope | Status |
|-------|--------|--------|
| **0** | Scaffold, DB schema, Railway | Complete |
| **1** | REST clients + discovery UI | Complete |
| **2** | Paper simulator, manual fill API, Polymarket WS on detail | Complete |
| **3** | Strategy engine, runner, strategies UI | Complete |
| **4** | Real execution + risk stack | Partial — coded + gated; not CI-tested |
| **5** | Backtest, Grok, docs, tests | Partial — replay realism, variant persistence remain |

## Deployment

Primary target: **Railway** (`railway.toml`).

1. Postgres plugin → `DATABASE_URL`
2. Shell: `npm run db:push`
3. Secrets: [`.env.example`](.env.example)
4. Redeploy

Real trading (opt-in, server-side only): `SNIPER_ENABLE_REAL_EXECUTION=true`, platform keys, strategy with `paperOnly: false`.

## Tech Stack

- Next.js 16 (App Router), TypeScript strict, ESLint
- Drizzle ORM + PostgreSQL
- Polymarket: `@polymarket/clob-client-v2`, Gamma API, viem
- Kalshi: REST + WS on detail pages
- Vitest (57 unit tests), Playwright (e2e)
- xAI Grok via Vercel AI SDK (optional)

## Safety & Disclaimers

- Not financial, legal, or investment advice.
- Past simulated performance ≠ future results.
- You are responsible for every trade, key, and dollar.
- Use paper until you have evidence of edge on your strategies and tolerance.

## License

MIT (personal use encouraged; commercial redistribution of trading logic requires care).
