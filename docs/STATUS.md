# Project Status

**Last verified:** June 2, 2026 (paper P&L ledger, runner speed/accuracy pass, risk-unified sizing).

This document is the **authoritative capability matrix** for reviewers. If README or other docs disagree with this file, **this file wins** until updated.

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
- CI: ESLint, build, 57 unit tests, Playwright e2e

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
| Replay “realistic passive fills” toggle | **Not implemented** | API/UI pass flag; replay engine ignores it |
| Synthetic backtest (price series) | **Works** | In-process; no DB |
| Risk modes (NORMAL / DEFENSIVE / EMERGENCY) | **Works** | In-process + durable `system_state` on transition |
| Edge decay → risk mode | **Works** | `recordWindow()` fed from per-strategy paper PnL each cycle |
| Temporary Grok adjustments expiration | **Works** | `incrementRunCount()` at start of each `runOnce()` |
| Grok market intel (`/api/grok/intel`) | **Works** | Requires xAI key |
| Grok research agent (`/api/research/agent`) | **Works** | Text + JSON/`PROPOSALS` proposal parsing |
| RECOMMENDED ACTIONS parse + auto-apply | **Works** | Pause/reduce allocation/downweight; audited |
| Strategy variants | **Partial** | In-memory only; lost on restart |
| Performance attribution API | **Works** | Per-strategy PnL via `paper_trades` → `signals` joins |
| Dynamic strategy allocator | **Works** | Weights by recent PnL + activity |
| Polymarket live WebSocket (market detail) | **Works** | Detail page only |
| Kalshi WebSocket client | **Works (detail page)** | `KalshiWSClient` on `/markets/kalshi/[id]` |
| Real Polymarket limit orders | **Coded, gated** | `SNIPER_ENABLE_REAL_EXECUTION` + keys; not CI-tested |
| Real Kalshi execution | **Coded, gated** | `kalshi-trading.ts` + recon; requires Kalshi API keys |
| Cross-venue arbitrage | **Not implemented** | — |
| `positions` DB table | **Partial** | Used for real fill tracking; paper uses `paper_trades` aggregation |
| `/real` status page | **Placeholder** | Does not read server execution flag |
| `/api/paper/pnl` | **Works** | Lightweight ledger + MTM snapshot |
| CI (lint, build, unit, e2e) | **Works** | 57 unit tests; smoke not in CI |

---

## Critical blockers

These remain for calling the system **fully production-ready** as autonomous 24/7 real-money trading:

### 1. ~~`signals.market_id` foreign key mismatch~~ **Fixed**

Runner and reconciliation call `ensureMarketRecord()` before signal/trade inserts.

### 2. In-memory state lost on restart

Partially mitigated via `system_state` (kill switch, risk mode, risk snapshots, execution health). Still in-memory on restart: runner session counters, strategy variants, execution manager fill history, edge decay windows, temporary adjustments (until re-loaded from DB if persisted).

### 3. Documented features with no implementation

| Feature | Location | Issue |
|---------|----------|-------|
| Realistic passive replay fills | `lib/data/historical.ts` | `realisticPassiveFills` param unused |
| Strategy variant persistence | `lib/strategies/variants.ts` | In-memory only |
| Runner WS book feed | `lib/runner/engine.ts` | REST books only in runner (WS on detail page) |
| Automated tests for runner / `evaluate()` | — | Not in CI |

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
| Unit (Vitest) | 57 tests / 15 files | orderbook, kalshi, quick-flip, ledger, sizing, paper-simulator, system-state, … |
| Smoke | 14 checks | `scripts/smoke-test.mjs` (not in CI) |
| E2E (Playwright) | 14 tests / 5 specs | Navigation, markets, strategies, backtest, paper fill |
| CI | lint + build + unit + e2e | `.github/workflows/ci.yml` |

No automated tests cover: full runner loop, strategies `evaluate()`, risk modes under load, real execution, Grok agent live calls.

---

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | System health, runner timing, recent audits |
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

Real execution requires **both** `SNIPER_ENABLE_REAL_EXECUTION=true` and a strategy with `paperOnly: false` (DB field; no UI toggle yet).

---

## Related docs

- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to contribute and remaining tasks
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design
- [OPERATIONS.md](./OPERATIONS.md) — running 24/7
