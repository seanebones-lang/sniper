# Sniper

**A research-first automated trading platform for Polymarket and Kalshi.**

Designed for small, consistent edges over long periods — not gambling or home runs.

> **High risk personal tool.** Most automated prediction market strategies lose money after fees, slippage, and adverse selection. You can lose all capital. Paper mode is strongly recommended for extended periods before any real money.

## What this is (and is not)

**Sniper is:**

- A market discovery and order book research UI (Polymarket + Kalshi)
- A paper-trading simulator with manual and (intended) automated fill paths
- A 24/7 runner that collects order book snapshots and evaluates strategies
- A backtesting lab with synthetic and historical replay
- An optional Grok (xAI) research layer for analysis and recommendations
- An optional, heavily gated real execution path for **Polymarket only**

**Sniper is not (today):**

- A fully unsupervised real-money trading bot
- A complete cross-venue arbitrage engine

**Authoritative sources:**
- [docs/STATUS.md](docs/STATUS.md) — detailed capability matrix
- [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md) — honest assessment for real capital use

**Wiki:** [GitHub Wiki](https://github.com/seanebones-lang/sniper/wiki) · source maintained in [`wiki/`](wiki/) (run `./wiki/sync-to-github.sh` to publish)

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
- **Self-protection first** — the system detects when it is getting hurt and reduces risk automatically (in-process while the runner is up).
- **Research flywheel** — snapshot collection → analysis → recommendations → replay validation.
- **Execution quality matters** — adverse selection and poor fills destroy edges.
- **Auditable everything** — decisions should have traceable reasons (`audit_events`, signal reasons).

## What works today (June 2026)

| Area | Status | Notes |
|------|--------|-------|
| Polymarket + Kalshi market discovery + order books | Works | |
| Markets UI + last prices | Works | |
| Manual paper fills | Works | |
| Strategy creation + runner (paper) | Works | 4 strategy types |
| Runner automated signal → DB → fill pipeline | **Fixed** | Uses `ensureMarketRecord` before every signal |
| Historical snapshot collection + replay | Works | |
| Grok Research Agent + proposals | Works | Requires `XAI_API_KEY` |
| Real execution durability | Strong | Persistent kill switch + rich risk snapshots across restarts |
| Risk system | Strong + Hardening | MaxDrawdown tracking + circuit breaker, real position-driven exposure |
| Kalshi real execution | Hardening | Authenticated client + active order/fill polling in reconciliation |
| Polymarket real execution | Gated + Hardening | Durable gates + basic open-order reconciliation |
| CI | Good | Lint, tsc, tests (22), build, smoke, vulnerability scan |
| Observability | Improving | `/api/health` surfaces durable risk snapshots |

**Honest assessment for real capital:** See [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md).

Full detailed matrix: [docs/STATUS.md](docs/STATUS.md).

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
3. Start the runner — collects snapshots and evaluates strategies.
4. **Markets** (`/markets`) — order books; **use manual paper fill here** for reliable DB fills today.
5. **Backtest** (`/backtest`) — historical replay after snapshots accumulate.
6. **Health** (`/health`) — risk mode and execution health (in-process state).

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
npm run lint
npm run test          # 22 unit tests (risk, durability, execution, reconciliation)
npm run test:ci       # lint + build + unit
npm run test:smoke
npm run test:e2e
npm run test:all
```

CI runs the full pipeline including Postgres service container.

## UI & API (Key Routes)

| Route | Purpose |
|-------|---------|
| `/` | Landing |
| `/dashboard` | Overview |
| `/strategies` | Strategy management + runner control |
| `/markets` | Discovery + order books |
| `/health` | Risk mode, execution health, durable snapshots |
| `/backtest` | Replay & research lab |
| `/markets` | Market discovery |
| `/markets/[platform]/[id]` | Order book, manual paper fill, Grok intel, Polymarket WS |
| `/strategies` | Strategies + runner control |
| `/backtest` | Synthetic + historical replay, Grok lab |
| `/settings` | Grok API key + research agent toggle |
| `/health` | Risk mode, execution health, recommendations |
| `/real` | Real execution warnings (placeholder status UI) |

API reference: [docs/STATUS.md#api-routes](docs/STATUS.md#api-routes).

## Documentation

| Doc | Description |
|-----|-------------|
| [Wiki (GitHub)](https://github.com/seanebones-lang/sniper/wiki) | Full documentation with navigation — source in [`wiki/`](wiki/) (run sync script to publish) |
| [docs/STATUS.md](docs/STATUS.md) | **Authoritative capability matrix and blockers** |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute; fix list; dev setup |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design |
| [docs/STRATEGIES.md](docs/STRATEGIES.md) | Strategy types and config |
| [docs/RISK.md](docs/RISK.md) | Risk layers |
| [docs/EXECUTION.md](docs/EXECUTION.md) | Execution layer |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Research flywheel |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | 24/7 ops and CI |
| [specs/001-sniper-mvp/](specs/001-sniper-mvp/) | Original MVP spec |

## MVP Phases

| Phase | Scope | Status |
|-------|--------|--------|
| **0** | Scaffold, DB schema, Railway | Complete |
| **1** | REST clients + discovery UI | Complete |
| **2** | Paper simulator, manual fill API, Polymarket WS on detail | Complete |
| **3** | Strategy engine, runner, strategies UI | Mostly complete — [automated fill FK blocker](docs/STATUS.md#1-signalsmarket_id-foreign-key-mismatch) |
| **4** | Real execution + risk stack | Partial — Polymarket gated; Kalshi N/A; DB portfolio incomplete |
| **5** | Backtest, Grok, docs, tests | Partial — core paths exist; see [STATUS.md](docs/STATUS.md) |

## Deployment

Primary target: **Railway** (`railway.toml`).

1. Postgres plugin → `DATABASE_URL`
2. Shell: `npm run db:push`
3. Secrets: [`.env.example`](.env.example)
4. Redeploy

Real trading (opt-in, server-side only): `SNIPER_ENABLE_REAL_EXECUTION=true`, `POLYMARKET_PRIVATE_KEY`, strategy with `paperOnly: false`.

## Tech Stack

- Next.js 16 (App Router), TypeScript strict, ESLint
- Drizzle ORM + PostgreSQL
- Polymarket: `@polymarket/clob-client-v2`, Gamma API, viem
- Kalshi: REST (+ WS client library, not wired in UI)
- Vitest (unit), Playwright (e2e), smoke script
- xAI Grok via Vercel AI SDK (optional)

## Safety & Disclaimers

- Not financial, legal, or investment advice.
- Past simulated performance ≠ future results.
- You are responsible for every trade, key, and dollar.
- Use paper until you have evidence of edge on your strategies and tolerance.

## License

MIT (personal use encouraged; commercial redistribution of trading logic requires care).
