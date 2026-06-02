# Project Status

**Last verified:** June 2, 2026 (nested `main` + Kalshi/quick-flip runner fixes).

This document is the **authoritative capability matrix** for reviewers. If README or other docs disagree with this file, **this file wins** until updated.

## Summary

Sniper is a **research and paper-trading platform** with optional, gated real execution on Polymarket. It is **not** production-ready as a fully autonomous 24/7 trading system until the blockers in [Critical blockers](#critical-blockers) are resolved.

What reviewers can evaluate today with confidence:

- Market discovery and order book UI (Polymarket + Kalshi REST)
- Manual paper fills (UI + API → `paper_trades`)
- Strategy evaluation logic (five strategy types including live-quick-flip)
- Runner loop with Polymarket + Kalshi near-term market pools
- Historical replay (when snapshots exist)
- Grok analysis (with xAI key; text output + RECOMMENDED ACTIONS parsing)
- CI: ESLint, build, unit tests, Playwright e2e

---

## Capability matrix

| Capability | Status | Notes |
|------------|--------|-------|
| Polymarket discovery + order books (REST) | **Works** | Gamma + CLOB; `externalId` must be CLOB token ID |
| Kalshi discovery + order books (REST) | **Works** | `orderbook_fp` parser; `close_time` for quick-flip window |
| Markets UI + last prices | **Works** | Polymarket + Kalshi filters; Kalshi WS on detail page |
| Manual paper fill (`POST /api/paper/fill`, market UI) | **Works** | Persists to `paper_trades` |
| Runner loop (evaluate, snapshots, risk modes) | **Works** | 4–12s interval; `/api/runner` diagnostics |
| Runner automated signal → DB → paper fill | **Works** | `ensureMarketRecord` before signal insert |
| Strategy types (`evaluate()`) | **Works** | + live-quick-flip (3h resolution window) |
| Strategy CRUD + runner start/stop UI | **Works** | Dashboard separates system risk vs trading style |
| `market_snapshots` collection | **Works** | When runner active and book data present |
| Historical replay | **Works** | Requires prior runner soak; 0 snapshots = empty result |
| Replay “realistic passive fills” toggle | **Not implemented** | API/UI pass flag; replay engine ignores it |
| Synthetic backtest (price series) | **Works** | In-process; no DB |
| Risk modes (NORMAL / DEFENSIVE / EMERGENCY) | **Works in-process** | Resets on restart; not persisted |
| Portfolio / Kelly sizing | **Partial** | Runs but uses placeholder portfolio state (no live positions DB) |
| Edge decay → risk mode | **Not wired** | `recordWindow()` never called |
| Grok market intel (`/api/grok/intel`) | **Works** | Requires xAI key |
| Grok research agent (`/api/research/agent`) | **Works** | Text analysis; structured `proposals[]` always empty |
| RECOMMENDED ACTIONS parse + auto-apply | **Partial** | Text parsing works; see temporary adjustments bug |
| Temporary Grok adjustments expiration | **Broken** | `incrementRunCount()` never called |
| Strategy variants | **Partial** | In-memory only; lost on restart |
| Performance attribution API | **Partial** | Placeholder logic; not true per-strategy joins |
| Polymarket live WebSocket (market detail) | **Works** | Detail page only |
| Kalshi WebSocket client | **Works (detail page)** | `KalshiWSClient` on `/markets/kalshi/[id]` |
| Real Polymarket limit orders | **Coded, gated** | `SNIPER_ENABLE_REAL_EXECUTION` + `POLYMARKET_PRIVATE_KEY`; not CI-tested |
| Real Kalshi execution | **Coded, gated** | `kalshi-trading.ts` + recon; requires `KALSHI_ACCESS_KEY` / `KALSHI_RSA_PRIVATE_KEY` |
| Cross-venue arbitrage | **Not implemented** | — |
| `positions` DB table | **Not wired** | Schema only |
| `markets` DB table sync | **Works** | Runner `syncMarketsToDb` + `ensureMarketRecord` each cycle |
| `/real` status page | **Placeholder** | Client env var; does not read server execution flag |
| CI (lint, build, unit, e2e) | **Works** | Smoke tests not in CI; e2e may call live Polymarket API |

---

## Critical blockers

These remain for calling the system **fully production-ready** as autonomous 24/7 real-money trading:

### 1. ~~`signals.market_id` foreign key mismatch~~ **Fixed**

- Runner and reconciliation call `ensureMarketRecord()` before signal/trade inserts.
- `syncMarketsToDb()` runs at the start of each runner cycle.

### 2. In-memory state lost on restart

Module singletons (not persisted): runner status, strategy variants, AI recommendations queue, execution manager health, risk mode, temporary adjustments.

### 3. Documented features with no implementation

| Feature | Location | Issue |
|---------|----------|-------|
| Realistic passive replay fills | `lib/data/historical.ts` | `realisticPassiveFills` param unused |
| Adjustment expiration | `lib/monitoring/temporary-adjustments.ts` | `incrementRunCount()` never called |
| Edge decay input | `lib/monitoring/edge-decay.ts` | `recordWindow()` never called |
| Structured Grok proposals | `lib/research/grok-agent.ts` | Always returns empty `proposals[]` |

---

## MVP phases (accurate)

| Phase | Scope | Status |
|-------|--------|--------|
| **0** | Scaffold, DB schema, Railway config | **Complete** |
| **1** | REST market clients + discovery UI | **Complete** |
| **2** | Paper simulator, manual paper fill API, Polymarket WS on detail page | **Complete** (Kalshi WS: client only) |
| **3** | Strategy engine, runner loop, strategies UI | **Complete** — quick-flip + Kalshi in runner pool |
| **4** | Guarded real execution + risk stack | **Partial** — Polymarket + Kalshi paths coded + gated; portfolio DB incomplete |
| **5** | Backtest, Grok, docs, tests | **Partial** — core UI/API exist; variant persistence, proposal parsing, replay realism, audit export, broader tests remain |

---

## Test coverage (verified)

| Layer | Count | Scope |
|-------|-------|--------|
| Unit (Vitest) | 47+ tests / 12+ files | orderbook, kalshi, quick-flip, ensure-market, paper-simulator, system-state, … |
| Smoke | 14 checks | `scripts/smoke-test.mjs` (not in CI) |
| E2E (Playwright) | 14 tests / 5 specs | Navigation, markets, strategies, backtest, paper fill |
| CI | lint + build + unit + e2e | `.github/workflows/ci.yml` |

No automated tests cover: runner loop, strategies evaluate(), risk modes, real execution, Grok agent.

---

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | System health JSON |
| GET | `/api/markets` | Market discovery |
| GET | `/api/markets/orderbook` | Order book + metadata |
| GET/POST | `/api/settings` | Grok key + research toggle |
| GET/POST | `/api/strategies` | Strategy list / create |
| PATCH | `/api/strategies/[id]` | Toggle active, etc. |
| GET | `/api/strategies/variants` | In-memory variants |
| GET/POST | `/api/runner` | Status / start / stop |
| POST | `/api/paper/fill` | Manual paper fill |
| POST | `/api/grok/intel` | Single-market Grok analysis |
| POST | `/api/research/agent` | Grok research agent |
| POST | `/api/research/replay` | Historical replay |
| GET | `/api/research/proposals` | Proposal audit events |
| GET | `/api/research/performance` | Attribution (placeholder) |
| POST | `/api/research/apply-proposal` | Create variant (placeholder compare market) |
| POST | `/api/research/apply-recommendation` | Apply/ignore Grok rec |

---

## Environment variables

See [`.env.example`](../.env.example). Server-side secrets are never exposed to the browser.

Real execution requires **both** `SNIPER_ENABLE_REAL_EXECUTION=true` and a strategy with `paperOnly: false` (DB field; no UI toggle yet).

---

## Related docs

- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to fix the blockers above
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design
- [OPERATIONS.md](./OPERATIONS.md) — running 24/7
