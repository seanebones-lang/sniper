# Sniper — Project Status (Authoritative)

**Last updated:** 2026-06 (post 4-phase production readiness push: durability + maxDrawdown + reconciliation symmetry + testing + observability — 22 tests)

This document is the single source of truth for capability, known issues, and roadmap. All other docs (README, wiki, etc.) should defer to this file.

**Note to maintainers**: Please keep this file updated after any significant capability, safety, or infrastructure changes.

---

## Critical Blockers — RESOLVED

| ID | Description | Status | Notes |
|----|-------------|--------|-------|
| 1 | `signals.market_id` foreign key mismatch | **FIXED** | Root cause: live `Market` objects from `fetch*Markets` used external IDs as `id`. Runner inserted signals using non-existent or wrong UUIDs. <br><br>**Fix:** Added `lib/db/ensure-market.ts` (`ensureMarketRecord` + `ensureMarket`) with proper upsert on `(platform, externalId)`. Wired into `lib/markets.ts` and `lib/runner/engine.ts`. Signals now always reference valid internal UUIDs. Paper fill path now links `signalId`. |

All references to this blocker in older docs/wiki are now historical.

---

## Current Capability Matrix (June 2026)

| Area | Status | Details |
|------|--------|---------|
| Polymarket + Kalshi market discovery (REST) | Works | `getAllMarkets`, order books |
| Markets UI + last prices | Works | |
| Manual paper fills (`POST /api/paper/fill`) | Works | Reliable |
| Strategy creation + toggle (UI) | Works | 4 strategy types |
| Runner loop (evaluation, snapshots, risk modes) | Works | |
| **Automated signal → paper fill pipeline** | **Works** (post-fix) | Previously blocked by FK issue |
| Historical snapshot collection + replay | Works | Requires runner soak time |
| Grok Research Agent + recommendations | Works | Requires `XAI_API_KEY` + `ENABLE_GROK_RESEARCH_AGENT=true` |
| Settings UI for Grok key | Works | |
| Polymarket live WebSocket | Partial | Only on market detail page |
| Real Polymarket execution | Gated + Hardening | Full risk gates + durable kill switch + risk snapshots. Orders start as 'pending' with order IDs stored for reconciliation. Basic open-order reconciliation support added. |
| Real Kalshi execution | Hardening | Full authenticated client with getOrder/getOrders/getFills. Reconciliation actively polls exchange and auto-calls recordRealFill on confirmed fills. Balance pings + order status + fills discovery. |
| Full CI | Good + Improving | Real GitHub Actions workflow (`.github/workflows/ci.yml`). Includes Postgres, lint, typecheck, build, unit tests, and smoke test. E2E/Playwright foundation started but not yet stable in CI. |
| Risk system (PortfolioRiskManager, modes, temporary adjustments) | Strong + Hardening | MaxDrawdown tracking + circuit breaker added. calculateSafeSize now uses real positions-driven exposure and category limits. |
| Execution quality tracking + adverse selection detection | Strong | `ExecutionManager` |
| Durability & State Recovery | Strong | system_state table + rich risk snapshots. Kill switch, risk mode, daily loss, execution health, and full risk posture now persist across restarts. Runner recovers and acts on bad prior state. |
| Observability for Real Execution | Improving | /api/health surfaces lastRiskSnapshot, lastKillSwitchState, and execution health from durable store. |

---

## Known Remaining Issues / Debt (Non-Blocking)

- **Lint / Type Safety**: Core lib/ heavily cleaned. Remaining issues are mostly in tests and UI. Lint is strict in CI.
- **Real Execution Maturity**: Significantly hardened. Durable kill switch + risk snapshots. Active Kalshi order/fill polling in recon. Polymarket reconciliation support added. Still experimental for fully hands-off real money (partial fills, marks, and deep on-chain confirmation need more work).
- **E2E & Integration Testing**: 22 passing unit tests with good coverage of risk, durability, and reconciliation paths. E2E remains basic. High-stakes real execution paths still need more guarded integration tests.
- **Documentation**: Major runbooks and STATUS kept current. AGENTS.md strengthened with durability and maxDrawdown rules.
- **AGENTS.md / CLAUDE.md**: Strong and up to date with current safety invariants (durable state, maxDrawdown, reconciliation expectations).

### Recently Resolved (June 2026 — 4-Phase Production Readiness Push)
- **State Durability**: Rich `risk_snapshot` system. Runner now persists and recovers full risk posture (exposure, mode, health, maxDrawdown, bankroll) and actively reacts to previously bad states on startup.
- **Risk Exposure & Safety**: MaxDrawdown tracking + circuit breaker added to PortfolioRiskManager. calculateSafeSize uses real position-driven data + proper category limits.
- **Reconciliation**: Kalshi has full order/fill polling. Basic but real Polymarket open-order reconciliation added. recordRealFill now meaningfully exercised.
- **Observability**: /api/health now surfaces lastRiskSnapshot, lastKillSwitchState, and durable execution health.
- **Testing**: 22 passing tests with direct coverage of maxDrawdown and durability paths.
- **Process**: Continued strict "verify → commit → push" discipline across all phases.

---

## API Routes (High Level)

See README and code for full list. Key ones:
- `/api/health`
- `/api/paper/fill`
- `/api/runner/*` (start/stop/status)
- `/api/strategies`
- `/api/backtest/*`

---

## How to Verify the FK Fix Locally

1. `npm run dev`
2. Create an active strategy (paperOnly recommended).
3. Start the runner from the Strategies page.
4. Observe logs: you should see `runner_signal_created` audit events with real `marketDbId` values (UUIDs).
5. Check the `signals` and `paper_trades` tables — `market_id` should be valid FKs and `signal_id` should be populated on fills.

---

**Maintainers**: Keep this file up to date whenever capability changes or major bugs are fixed. Do not let README or wiki become the source of truth for status.

This document was restored as part of the June 2026 FK + market sync reliability fix.
