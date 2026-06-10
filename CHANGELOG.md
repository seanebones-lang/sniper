# Changelog

All notable changes to the Sniper project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — June 10, 2026 Performance & Security Hardening Pass

### Security
- **API auth now covers every mutating route.** Previously unprotected: `POST /api/strategies`, `POST /api/paper/fill`, `POST /api/paper/run`, `PATCH /api/paper/portfolio`, `POST /api/grok/intel`, `POST /api/research/{agent,replay,apply-proposal,apply-recommendation}`, and `PATCH /api/real/intelligence` (which can unpause live entries). All UI callers attach the stored bearer token.
- **Timing-safe secret comparison** in `lib/api-auth.ts` (SHA-256 + `crypto.timingSafeEqual` instead of `===`).
- **Security headers** (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) on all responses via `next.config.ts`.
- **Startup warning** when live execution is enabled without `SNIPER_API_SECRET`.
- **Input validation hardened**: zod schema on strategy creation (name/type length caps), replay window capped at 14 days, malformed-JSON bodies return 400 instead of 500 across mutating routes.
- **`https-proxy-agent` upgraded 5.x → 7.x** (EOL dependency).

### Performance
- **Market pool fetches parallelized** (`lib/markets.ts`): quick-flip, live near-term, and BTC sniper pools fetch all sources concurrently via `Promise.allSettled` — saves several hundred ms per runner cycle, more when a source is slow.
- **Batched market upsert** (`ensureMarketRecordsBatch`): the runner's per-cycle market sync went from ~50 individual upserts to 1 chunked `INSERT … ON CONFLICT` statement (per-row fallback retained).
- **Hot-path indexes** (`db/migrations/0002_hot_path_indexes.sql`): `audit_events(created_at)`, `audit_events(action, created_at)`, `real_trades(status, created_at)` — these tables are written every cycle and were seq-scanned by health/ops reads and the pending-order guard. Apply with `npm run db:push`.
- **Paper portfolio query rework**: signal counts via `GROUP BY` instead of hydrating every signal row in the window (the dashboard polls this every 5s); fills join their strategy inline instead of a second lookup round.
- **Runner engine**: open-position market metadata fetched in parallel (was sequential per position), strategy rows queried once per cycle (was twice), cooldown map pruned so multi-week soaks don't grow it unbounded, mark-to-market batch size 6 → 12.
- **Dev DB pool reuse**: `lib/db` caches the postgres client on `globalThis` so HMR reloads don't leak 10-connection pools.

### UI
- **Polling pauses in hidden tabs** (dashboard, paper, strategies, real, health, zen, live portfolio card) — a backgrounded tab no longer hammers portfolio/equity endpoints; zen refreshes immediately on return.
- **Zen view rendering fixes**: momentum bars no longer reset the canvas backing store on every animation frame; equity river and momentum bars keep their animation loops across data polls (data flows through refs); static overlays memoized.
- Removed unused `@tanstack/react-query` dependency.

---

## June 2, 2026 — Accuracy & Speed Pass

### Added
- **Paper P&L ledger + mark-to-market** (`lib/paper/ledger.ts`, `lib/paper/mark-to-market.ts`)
  - Cash ledger with average-cost realized PnL; live marks for open positions.
  - Dashboard and `/paper` show equity, realized/unrealized P&L, cash available.
- **Risk-unified paper state** (`lib/paper/risk-state.ts`)
  - `loadPaperRiskState()` feeds `PortfolioRiskManager` each runner cycle.
  - Exit signals bypass exposure/daily-loss circuit breakers.
- **Runner performance**
  - Per-cycle deduplicated book cache (`lib/runner/book-cache.ts`).
  - Overlap guard + adaptive interval (4–12s).
  - Snapshot feature loading; regime passed to strategies; cooldown enforced.
- **USD → shares sizing** (`lib/risk/sizing.ts`) — Kelly USD caps converted correctly in runner + real executor.
- **Edge decay + allocator**
  - `recordWindow()` from per-strategy paper PnL.
  - Allocator weights by recent PnL + activity.
- **API**
  - `GET /api/paper/pnl` — lightweight P&L endpoint.
  - Runner GET uses cheap counts; `?includePnl=1` optional.
- **Grok** — JSON/`PROPOSALS` proposal parsing in research agent.
- **Demo video** — `docs/demo/sniper-paper-trading-demo.mov` on README.
- **Tests** — 57 unit tests (ledger, sizing, + existing suite).

### Changed
- Dashboard consolidated to single 5s portfolio poll.
- Performance attribution uses `filledAt` + run-session scoping.
- Paper simulator uses book imbalance and regime from runner.
- Resolution proximity uses `market.endDate` when available.
- `/api/health` exposes runner cycle timing and recent audits.

### Fixed
- Grok global risk multiplier no longer overwritten by risk-mode multiplier.
- Real fill counter double-increment in runner.
- Book cache prefetch includes quick-flip 40-market window + open positions.

---

## [Unreleased] — June 2026 Production Hardening

### Added
- **Durable Risk State** (`system_state` table + rich `risk_snapshot`)
  - Kill switch, risk mode, daily loss, execution health, exposure, and maxDrawdown now persist across restarts.
  - Runner recovers previous risk posture on startup and can react defensively.
- **MaxDrawdown Tracking + Circuit Breaker**
  - `PortfolioRiskManager` now tracks peak bankroll and running drawdown.
  - `calculateSafeSize` enforces maxDrawdown limit.
- **Reconciliation Hardening**
  - KalshiTradingClient: real `getOrder`, `getOrders`, `getFills`.
  - `reconcilePendingRealTrades` actively polls and auto-reconciles confirmed fills.
  - Basic open-order reconciliation for Polymarket.
  - `recordRealFill` now defensively calls `ensureMarket`.
- **Observability**
  - `/api/health` now surfaces last persisted risk snapshot, kill switch state, and execution health.
- **Testing**
  - Test count increased to 22 with direct coverage of durability and risk mechanisms.

### Changed
- Real orders on Polymarket now start as `pending` (with order ID) instead of optimistically `filled`.
- Stronger ID discipline enforcement in reconciliation paths.

## [Previous]

### Added
- **Risk Mode System** (`NORMAL` / `DEFENSIVE` / `EMERGENCY`)
  - Explicit risk modes that automatically change runner behavior (strategy filtering, market limits, sizing conservatism).
  - `RiskModeManager` with automatic evaluation based on system health, adverse execution rate, and edge decay.
- **Temporary Adjustments System**
  - Grok recommendations can now create temporary risk changes (global risk reduction, strategy downweighting) that auto-expire.
- **ExecutionManager v3**
  - Advanced passive order management (`handleBookUpdate`, `manageRestingOrders`).
  - Per-market execution health tracking with automatic downweighting.
  - Adverse selection response logic.
- **Automated Intelligence Layer**
  - Scheduled Grok Research Agent calls with rich context.
  - Structured, actionable recommendations with parsing and lifecycle tracking.
  - One-click + auto-application of safe recommendations.
- **Edge Decay Monitoring**
  - Dedicated monitor that detects strategy degradation and feeds into risk decisions.
- **Realistic Passive Fill Simulation**
  - Significantly improved passive order behavior in the Paper Simulator.
  - Optional realistic fill mode in the historical replay engine for higher research fidelity.
- **Strategy Health Dashboard** (`/health`)
  - Live view of risk mode + active restrictions, execution quality, AI recommendations, and temporary adjustments.
- Comprehensive documentation overhaul (README + full `docs/` suite).

### Changed
- Runner self-protection is now active and behavioral (not just logging).
- Research flywheel is now closed-loop with measurable recommendation outcomes.

---

## [0.2.0] - 2026-06

### Added
- Full Risk Mode behavioral system.
- Grok Research Agent with structured proposals and auto-applicable temporary adjustments.
- Realistic passive fill simulation in paper and replay.
- ExecutionManager with order lifecycle and health tracking.
- Edge decay monitoring.

### Documentation
- Major updates to all core documentation.

---

## [0.1.0] - Initial Development

- Initial architecture: Next.js + Drizzle + Railway.
- Multi-venue data ingestion (Polymarket + Kalshi) with WebSockets.
- Paper trading simulator.
- Multiple trading strategies.
- Professional risk management foundation.
- Grok integration for research.
- Replay engine and variants system.
- Basic observability and alerting.
