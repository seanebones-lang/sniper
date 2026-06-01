# Sniper — Project Status (Authoritative)

**Last updated:** 2026-06 (post FK + market sync fix)

This document is the single source of truth for capability, known issues, and roadmap. All other docs (README, wiki, etc.) should defer to this file.

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
| Real Polymarket execution | Gated | `SNIPER_ENABLE_REAL_EXECUTION=true` + private key. Not CI-tested. Heavy warnings in UI. |
| Real Kalshi execution | Not implemented | |
| Full CI (lint + build + unit + e2e) | Partial | See `package.json` scripts and `.github/workflows` |
| Risk system (PortfolioRiskManager, modes, temporary adjustments) | Strong | One of the most complete parts of the system |
| Execution quality tracking + adverse selection detection | Strong | `ExecutionManager` |

---

## Known Remaining Issues / Debt (Non-Blocking)

- **Test surface**: README describes more test commands than currently declared in `package.json`. Smoke/e2e scripts need alignment.
- **Documentation drift**: Older references may still exist in wiki or comments.
- **Real execution**: Still considered experimental. No automated reconciliation or kill-switch beyond basic gates.
- **Kalshi WS**: Client library exists but not fully wired into UI/runner.
- **AGENTS.md / CLAUDE.md**: Improved in June 2026 but can be expanded further.

### Recently Resolved (June 2026)
- **Repo hygiene (Major win)**: Removed a 1.4 GB nested duplicate `sniper/sniper/` directory that had been polluting the repository (contained full copy + `.env.local` + `.next/`). Hardened `.gitignore` to prevent recurrence. Project size dropped from ~2.4G to ~980M.
- **signals.market_id FK** — Fixed (see previous entry).

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
