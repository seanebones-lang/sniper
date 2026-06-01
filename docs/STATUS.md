# Sniper — Project Status (Authoritative)

**Last updated:** 2026-06 (post major Kalshi + CI + safety improvements)

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
| Real Polymarket execution | Gated + Improving | `SNIPER_ENABLE_REAL_EXECUTION=true` + private key. Basic kill-switch and reconciliation exist. Still not CI-tested for real paths. |
| Real Kalshi execution | Partial / Experimental | Trading client skeleton + placeOrder integration exists. Fill confirmation and full flows still thin. |
| Full CI | Good + Improving | Real GitHub Actions workflow (`.github/workflows/ci.yml`). Includes Postgres, lint, typecheck, build, unit tests, and smoke test. E2E/Playwright foundation started but not yet stable in CI. |
| Risk system (PortfolioRiskManager, modes, temporary adjustments) | Strong | One of the most complete parts of the system |
| Execution quality tracking + adverse selection detection | Strong | `ExecutionManager` |

---

## Known Remaining Issues / Debt (Non-Blocking)

- **Lint / Type Safety Debt**: ~70-80+ `any` / `as any` usages remain (as of mid-2026). Heaviest in execution layer, runner, and some data files. Lint currently runs non-blocking in CI.
- **Real Execution Maturity**: Still experimental. Kalshi support is partial. Reconciliation and position tracking for real trades need strengthening. Kill-switch is currently in-memory only.
- **E2E & Test Coverage**: Basic Playwright config and one trivial test exist. No coverage reporting. E2E not yet running in CI.
- **Documentation Gaps**: Operational runbooks for real money execution (especially Kalshi) are thin. Some older wiki/docs may be stale.
- **AGENTS.md / CLAUDE.md**: Solid core rules exist but can be expanded with more specific guidance around real execution and risk invariants.

### Recently Resolved (June 2026)
- **Repo hygiene (Major win)**: Removed a 1.4 GB nested duplicate `sniper/sniper/` directory. Hardened `.gitignore`.
- **signals.market_id FK** — Fixed (core automated pipeline now works).
- **Kalshi Support**: Significant progress — authenticated trading client skeleton, WebSocket integration in UI, real execution path started, Kalshi-specific reconciliation logic added.
- **Real Execution Safety**: Basic in-memory kill-switch (`disableRealExecution()`) + reconciliation wired into the runner.
- **Testing Foundation**: 16+ unit tests added across risk, execution, and Kalshi areas. Functional smoke test. Multiple "test → build → commit → push" cycles completed.
- **CI**: Proper GitHub Actions workflow created and hardened (concurrency, Postgres, full verification steps).
- **Runner & Execution Resilience**: Improved error handling, audit logging, and some `any` reduction in critical paths.
- **Lint Debt**: Initial reduction campaign started on high-risk files (runner + execution layer).

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
