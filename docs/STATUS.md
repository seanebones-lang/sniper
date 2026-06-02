# Sniper — Project Status (Authoritative)

**Last updated:** 2026-06 (post major durability + reconciliation + exposure work — 21 tests)

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
| Real Polymarket execution | Gated + Solid skeleton | Full gates (risk, execution mgr, kill-switch in-memory+env, recon). recordRealFillForPosition with strict ID discipline (ensureMarket). |
| Real Kalshi execution | Improved / Experimental | Authenticated KalshiTradingClient wired (placeOrder + getBalance). Recon loop now pings client for liveness. Guarded safety tests. Still no full auto fill polling. |
| Full CI | Good + Improving | Real GitHub Actions workflow (`.github/workflows/ci.yml`). Includes Postgres, lint, typecheck, build, unit tests, and smoke test. E2E/Playwright foundation started but not yet stable in CI. |
| Risk system (PortfolioRiskManager, modes, temporary adjustments) | Strong | One of the most complete parts of the system |
| Execution quality tracking + adverse selection detection | Strong | `ExecutionManager` |

---

## Known Remaining Issues / Debt (Non-Blocking)

- **Lint / Type Safety**: Core lib/ (runner, risk, execution, research) heavily cleaned (no-explicit-any near zero outside tests; many unused vars eliminated). ~36 errors remain (mostly test mocks + some React UI/pages with any/hooks). Lint is strict in CI (no || true).
- **Real Execution Maturity**: Significantly hardened. KalshiTradingClient fully wired + exercised in recon. record*Fill helpers + ensureMarket discipline. 2+ guarded kill-switch tests. Still experimental (no full auto polling on Kalshi/Polymarket for fills yet; position math pragmatic). Kill-switch (env + in-memory) solid.
- **E2E & Test Coverage**: 18 passing unit tests (risk, execution, recon foundations, ensure-market, Kalshi client). Playwright + coverage in CI. E2E still basic (one spec). 
- **Documentation**: Runbooks (real-execution + kalshi-support) now have daily checklists, SQL verification queries, error patterns, auth steps, emergency procedures. STATUS and AGENTS kept current.
- **AGENTS.md / CLAUDE.md**: Core rules strong (paper sacred, ID discipline via ensureMarket, audit everything, risk first). Can still add more examples.

### Recently Resolved (June 2026, multiple cycles)
- **Repo hygiene (Major win)**: Removed 1.4 GB nested duplicate. Hardened .gitignore.
- **signals.market_id FK** — Fixed.
- **State Durability (Critical for 24/7 real $)**: New system_state table + service. Kill switch, risk mode, daily loss, and execution health now persist across restarts with recovery logging in the runner.
- **Reconciliation Maturity**: KalshiTradingClient now has real getOrder/getOrders/getFills. Recon actively polls exchange order status and calls recordRealFill with confirmed data. Polymarket orders now start as 'pending' with order IDs stored.
- **Risk Exposure**: getCurrentPortfolioState improved to use the positions table as primary source (populated by reconciliation).
- **Testing**: 21 passing.
- **Process**: Strict gated batches with commit + push on every meaningful change.

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
