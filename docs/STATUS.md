# Project Status

**Last verified:** June 10, 2026 (performance & security pass: full mutating-route auth coverage, timing-safe token compare, security headers, hot-path DB indexes, parallel market fetches, batched market sync).

This document is the **authoritative capability matrix** for reviewers. If README or other docs disagree with this file, **this file wins** until updated.

## Live-trading safety pass (June 3, 2026)

The real-money path was hardened so it is safe to soak with tiny capital. Changes:

- **Real-position exit lifecycle:** real fills attribute to a strategy; `getRealOpenPositionsByStrategy()` feeds the exit engine for `paperOnly:false` strategies.
- **Reconciliation hardening:** token-balance fallback for BUY/SELL confirmation; `tryImmediatePolymarketFill` after submit; idempotent `recordRealFill`; `needs_review` draining + throttled alerts.
- **Ghost inventory audit:** `scripts/reconcile-ledger-vs-chain.ts` compares ledger vs on-chain balances; can cancel phantom pending BUYs (`APPLY=1`).
- **Live ops:** `/real` dashboard + `GET /api/real/ops` (positions, pending orders, `needs_review`, runner lock, kill switch).
- **Readiness:** `GET /api/health/ready` — DB, runner cycle age, `needs_review` backlog, kill switch, alert channel when live.
- **API auth:** `SNIPER_API_SECRET` bearer token on mutating routes (`POST /api/runner`, strategy PATCH, settings, `/api/real/*` POST).
- **Grok live guard:** auto-apply skipped when any active strategy is `paperOnly:false`.
- **Micro sizing:** entries capped by `maxSizeUsd`, spendable USDC, and total exposure (~95% of bankroll) — no fixed position-count limit.
- **Zen PnL:** live equity uses `filled` real trades only (excludes `needs_review`).

**Live mode:** `live-quick-flip` can run with `paperOnly:false` when `SNIPER_ENABLE_REAL_EXECUTION=true`. Runner auto-starts on deploy (watchdog restarts if stopped). Complete the [soak gate](runbooks/real-execution.md#soak-gate-before-scaling-capital) before scaling capital.

## Summary

Sniper is a **research and paper-trading platform** with optional, gated real execution on Polymarket and Kalshi. It is **not** production-ready as a fully autonomous 24/7 real-money system until the blockers in [Critical blockers](#critical-blockers) are resolved.

What reviewers can evaluate today with confidence:

- Market discovery and order book UI (Polymarket + Kalshi REST + WS on detail pages)
- Manual and **automated paper fills** → `paper_trades` with ledger + mark-to-market P&L
- Five strategy types including live-quick-flip (3h resolution window)
- Runner loop with deduplicated book cache, adaptive interval, risk-unified sizing
- Dashboard paper P&L, equity, realized/unrealized breakdown
- Historical replay (when snapshots exist)
- Grok analysis + RECOMMENDED ACTIONS auto-apply + structured proposal parsing
- CI: ESLint, build, unit tests, Playwright e2e

---

## Capability matrix

| Capability | Status | Notes |
|------------|--------|-------|
| Polymarket discovery + order books (REST) | **Works** | Gamma + CLOB; `externalId` = CLOB token ID |
| Kalshi discovery + order books (REST) | **Works** | `orderbook_fp` parser; `close_time` for quick-flip |
| Markets UI + last prices | **Works** | Polymarket + Kalshi filters; Kalshi WS on detail page |
| Manual paper fill (`POST /api/paper/fill`, market UI) | **Works** | Persists to `paper_trades` |
| Runner loop (evaluate, snapshots, risk modes) | **Works** | 4–12s adaptive interval; overlap guard; cycle timing in `/api/health` |
| Runner automated signal → DB → paper fill | **Works** | `ensureMarketRecord` before signal insert |
| Paper P&L (ledger + MTM) | **Works** | `computePaperLedger` + `computeMarkToMarket`; dashboard + `/paper` |
| Risk sizing from paper ledger | **Works** | `loadPaperRiskState` → `setCyclePortfolioState` each cycle; exits bypass breakers |
| USD → shares sizing | **Works** | Kelly returns USD; `computeFinalShareSize` converts in runner + real executor |
| Strategy types (`evaluate()`) | **Works** | 5 types; regime from snapshots; cooldown enforced; resolution uses `endDate` |
| Strategy CRUD + runner start/stop UI | **Works** | Dashboard + `/paper` |
| `market_snapshots` collection | **Works** | Throttled 1-in-3 saves; loaded for feature extraction |
| Historical replay | **Works** | Requires prior runner soak; 0 snapshots = empty result |
| Replay “realistic passive fills” toggle | **Works** | Skips passive BUYs when spread >15% or insufficient book depth |
| Synthetic backtest (price series) | **Works** | In-process; no DB |
| Risk modes (NORMAL / DEFENSIVE / EMERGENCY) | **Works** | In-process + durable `system_state` on transition |
| Edge decay → risk mode | **Works** | `recordWindow()` fed from per-strategy paper PnL each cycle |
| Temporary Grok adjustments expiration | **Works** | `incrementRunCount()` at start of each `runOnce()` |
| Grok market intel (`/api/grok/intel`) | **Works** | Requires xAI key |
| Grok research agent (`/api/research/agent`) | **Works** | Text + JSON/`PROPOSALS` proposal parsing |
| RECOMMENDED ACTIONS parse + auto-apply | **Works** | Pause/reduce allocation/downweight; audited |
| Strategy variants | **Works** | Persisted to `system_state.strategy_variants` |
| Performance attribution API | **Works** | Per-strategy PnL via `paper_trades` → `signals` joins |
| Dynamic strategy allocator | **Works** | Weights by recent PnL + activity |
| Polymarket live WebSocket (market detail) | **Works** | Detail page only |
| Runner book hub (WS + REST) | **Partial** | WS when connected; REST fallback each cycle |
| Kalshi WebSocket client | **Works (detail page)** | `KalshiWSClient` on `/markets/kalshi/[id]` |
| Real Polymarket orders (entry + exit) | **Coded, gated** | `SNIPER_ENABLE_REAL_EXECUTION` + keys; entries FOK, exits FAK marketable; not CI-tested with live keys |
| Real-position exit lifecycle | **Works** | `getRealOpenPositionsByStrategy` → exit engine emits real SELLs for `paperOnly:false` |
| Real Kalshi execution | **Coded, gated** | `kalshi-trading.ts` + recon; requires Kalshi API keys |
| Single-runner lock | **Works** | `system_state` lease + heartbeat; fails closed when real execution is on |
| Durable safety-state restore | **Works** | risk mode, daily-loss, drawdown peak, execution-health restored on startup |
| Real exposure tracking | **Works** | `riskEngine.getRealExposure` / `checkRealExposure` from `positions` + pending `real_trades` |
| Cross-venue arbitrage | **Not implemented** | — |
| `positions` DB table | **Works** | Real fill tracking + exposure; paper uses `paper_trades` aggregation |
| `/real` status + live ops page | **Works** | Server status, ops panel (`/api/real/ops`), runner control |
| `GET /api/health/ready` | **Works** | DB, runner, reconciliation backlog, kill switch |
| API auth (production) | **Works** | `SNIPER_API_SECRET` on **all** mutating routes when set (timing-safe compare); UI sends stored bearer token |
| CI (lint, build, unit, e2e) | **Works** | Unit tests include reconcile, engine smoke, ledger-chain audit |

---

## Critical blockers

These remain for calling the system **fully production-ready** as autonomous 24/7 real-money trading:

### 1. ~~`signals.market_id` foreign key mismatch~~ **Fixed**

Runner and reconciliation call `ensureMarketRecord()` before signal/trade inserts.

### 2. In-memory state lost on restart — **largely mitigated (June 3, 2026)**

Critical safety state is now **restored** on startup from `system_state`: kill switch, risk mode, daily-loss tracking, drawdown high-water mark, and execution-health posture (boots DEFENSIVE if last health was poor). A single-runner lease prevents duplicate loops after a deploy. Still in-memory on restart (non-safety-critical): runner session counters, strategy variants, execution-manager fill history, edge-decay windows, temporary adjustments.

### 3. Documented features with no implementation

| Feature | Location | Issue |
|---------|----------|-------|
| Automated tests for full runner under load | — | Smoke test only; not load-tested |
| Real execution CI with live keys | — | Mocked unit tests only |

### 4. Known accuracy caveats (non-blocking)

| Caveat | Notes |
|--------|-------|
| Daily P&L baseline | Start-of-day equity uses cost basis for open positions; intraday MTM can skew daily loss breaker slightly |
| Long paper runs | Full run-session trades loaded for ledger (no 2000 cap on hydration) |
| Real execution | Kill-switch + gates coded; not CI-tested with live keys |

---

## MVP phases (accurate)

| Phase | Scope | Status |
|-------|--------|--------|
| **0** | Scaffold, DB schema, Railway config | **Complete** |
| **1** | REST market clients + discovery UI | **Complete** |
| **2** | Paper simulator, manual paper fill API, Polymarket WS on detail | **Complete** |
| **3** | Strategy engine, runner loop, strategies UI | **Complete** — quick-flip + Kalshi in runner pool |
| **4** | Guarded real execution + risk stack | **Partial** — Polymarket + Kalshi coded + gated; real path not CI-tested |
| **5** | Backtest, Grok, docs, tests | **Partial** — replay realism, variant persistence, runner integration tests remain |

---

## Test coverage (verified)

| Layer | Count | Scope |
|-------|-------|--------|
| Unit (Vitest) | 110+ tests / 25+ files | orderbook, kalshi, reconcile, engine smoke, ledger-chain audit, … |
| Smoke | 14 checks | `scripts/smoke-test.mjs` (not in CI) |
| E2E (Playwright) | 14 tests / 5 specs | Navigation, markets, strategies, backtest, paper fill |
| CI | lint + build + unit + e2e | `.github/workflows/ci.yml` |

No automated tests cover: full runner loop, strategies `evaluate()`, risk modes under load, real execution, Grok agent live calls.

---

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | System health, runner timing, recent audits |
| GET | `/api/health/ready` | Readiness probe (DB, runner, needs_review, kill switch) |
| GET | `/api/real/ops` | Live ops snapshot (positions, pending, needs_review) |
| GET | `/api/markets` | Market discovery |
| GET | `/api/markets/orderbook` | Order book + metadata |
| GET/POST | `/api/settings` | Grok key + research toggle |
| GET/POST | `/api/strategies` | Strategy list / create |
| PATCH | `/api/strategies/[id]` | Toggle active, etc. |
| GET | `/api/strategies/variants` | In-memory variants |
| GET/POST | `/api/runner` | Status / start / stop (lightweight; `?includePnl=1` optional) |
| GET | `/api/paper/portfolio` | Full portfolio snapshot |
| GET | `/api/paper/pnl` | Lightweight P&L only |
| POST | `/api/paper/fill` | Manual paper fill |
| POST | `/api/grok/intel` | Single-market Grok analysis |
| POST | `/api/research/agent` | Grok research agent |
| POST | `/api/research/replay` | Historical replay |
| GET | `/api/research/proposals` | Proposal audit events |
| GET | `/api/research/performance` | Per-strategy attribution + PnL |
| POST | `/api/research/apply-proposal` | Create variant |
| POST | `/api/research/apply-recommendation` | Apply/ignore Grok rec |

---

## Environment variables

See [`.env.example`](../.env.example). Server-side secrets are never exposed to the browser.

Real execution requires **both** `SNIPER_ENABLE_REAL_EXECUTION=true` and a strategy with `paperOnly: false` (DB field; Strategies PATCH or DB).

When `SNIPER_API_SECRET` is set, **every** mutating API route (POST/PATCH — runner, strategies, paper fill/run/budget, settings, research, grok, `/api/real/*`) requires `Authorization: Bearer <secret>` or `X-Sniper-Secret` header. The comparison is timing-safe. When live execution is enabled without a secret, startup logs a loud warning. Schema index changes are applied with `npm run db:push`.

---

## Related docs

- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to contribute and remaining tasks
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design
- [OPERATIONS.md](./OPERATIONS.md) — running 24/7
