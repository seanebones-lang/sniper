# Architecture

Sniper is designed as a **research + execution platform** first, trading bot second.

## High-Level Layers

1. **Data Layer**
   - Real-time: Polymarket CLOB WS + Kalshi WS
   - Historical: `market_snapshots` table with rich features (imbalance, depth, micro-price, regime, etc.)

2. **Research Layer**
   - Replay engine (`lib/data/historical.ts`)
   - Grok Research Agent (`lib/research/grok-agent.ts`) — analyzes performance + snapshots and outputs structured proposals
   - Variants system — turn proposals into testable configurations
   - Backtesting + comparison tools

3. **Strategy Layer**
   - Pluggable strategies (`lib/strategies/`)
   - Strategy Allocator — dynamically sizes strategies based on recent performance
   - Regime awareness (via feature extraction)

4. **Risk Layer** (most important)
   - `PortfolioRiskManager` — Kelly sizing, category limits, concentration penalties
   - `RiskModeManager` — explicit modes (NORMAL / DEFENSIVE / EMERGENCY) that change runner behavior
   - `TemporaryAdjustments` system — allows Grok to temporarily modify risk parameters with auto-expiration
   - Per-market execution health (from ExecutionManager)
   - Multi-level circuit breakers + edge decay monitoring

5. **Execution Layer**
   - `ExecutionManager` — central brain for passive vs aggressive decisions, adverse selection detection, order lifecycle management, and execution quality tracking
   - Actively used by both paper simulator and real executor

6. **Runner (24/7 brain)**
   - `lib/runner/engine.ts`
   - Evaluates active strategies on live data
   - Applies risk sizing + allocator + execution health throttle + risk mode behavioral changes
   - Self-protection logic (automatically downweights unhealthy markets and follows ExecutionManager recommendations)
   - Periodic Grok Research Agent calls with automated recommendation parsing

7. **Observability**
   - Structured audit events
   - `/api/health` endpoint
   - Telegram alerts
   - Performance attribution

## Design Principles

- **Paper first, always.** Real money is a feature flag with heavy guards.
- **Everything is auditable.** Every signal has a reason. Every size decision is logged.
- **Self-protecting > clever.** The system should detect when it is getting hurt and reduce risk automatically.
- **Research flywheel.** Data → Analysis (Grok) → Proposals → Variants → Replay validation → Promotion.
- **Small consistent edges.** We optimize for survival + many small wins, not home runs.

## Key Files

- `lib/runner/engine.ts` — the 24/7 heart
- `lib/execution/execution-manager.ts` — execution brain
- `lib/risk/portfolio-manager.ts` — risk brain
- `lib/strategies/allocator.ts` — dynamic capital allocation
- `lib/research/grok-agent.ts` — AI research co-pilot

## Deployment

Primary target: Railway (Postgres + always-on service).

Secrets that matter for real trading:
- `SNIPER_ENABLE_REAL_EXECUTION=true`
- `POLYMARKET_PRIVATE_KEY`
- `KALSHI_*` keys (when supported)
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (highly recommended)
- `XAI_API_KEY` (for Grok Research Agent)
- `ENABLE_GROK_RESEARCH_AGENT=true` (optional periodic analysis)
