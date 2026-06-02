# Architecture

Sniper is a **research + execution platform** first, trading bot second.

**Status:** See [STATUS.md](./STATUS.md) for verified capabilities and blockers.

## High-Level Layers

1. **Data Layer**
   - REST: Gamma API + Polymarket CLOB, Kalshi trade API
   - In-memory cache: `lib/markets.ts` (~25s TTL; force refresh on quick-flip cycles)
   - WebSocket: Polymarket + Kalshi on market detail pages
   - Historical: `market_snapshots` (throttled writes from runner; loaded for features)
   - Per-cycle book cache: `lib/runner/book-cache.ts` (deduplicated parallel REST)

2. **Research Layer**
   - Replay: `lib/data/historical.ts` (`realisticPassiveFills` param **not implemented**)
   - Features: `lib/data/features.ts` (regime from recent snapshots)
   - Grok agent: `lib/research/grok-agent.ts` (text + JSON proposal parsing)
   - Performance: `lib/research/performance.ts` (per-strategy PnL attribution)
   - Variants: `lib/strategies/variants.ts` (**in-memory**, lost on restart)
   - UI: `/backtest`

3. **Strategy Layer**
   - Five strategies in `lib/strategies/`
   - Allocator: PnL + activity weighted (`lib/strategies/allocator.ts`)
   - Regime passed via `StrategyContext.regime` from snapshot features
   - Cooldown enforced per strategy/market in runner

4. **Risk Layer**
   - `PortfolioRiskManager` — Kelly USD sizing from paper ledger + MTM (`lib/paper/risk-state.ts`)
   - `RiskModeManager` — NORMAL / DEFENSIVE / EMERGENCY (durable transitions)
   - `TemporaryAdjustments` — expire via `incrementRunCount()`
   - Edge decay monitor — fed from per-strategy PnL windows
   - Per-market execution health from ExecutionManager

5. **Execution Layer**
   - `ExecutionManager` — passive/aggressive, adverse selection
   - `PaperSimulator` — imbalance/regime-aware passive fills
   - `RealExecutor` — Polymarket + Kalshi; gated

6. **Runner**
   - `lib/runner/engine.ts` — adaptive 4–12s interval, overlap guard
   - Book cache prefetch includes quick-flip pool + open positions
   - Saves snapshots (1-in-3), evaluates strategies, Grok periodic analysis

7. **Observability**
   - `audit_events` in PostgreSQL
   - `/api/health` — risk, execution, runner timing, audits
   - `/api/paper/pnl` — lightweight P&L
   - Telegram (optional)

## Application Structure

```
app/
├── page.tsx, dashboard/          Landing + live P&L
├── paper/                        Full portfolio + runner
├── markets/                      Discovery + detail (WS)
├── strategies/                   CRUD + runner control
├── backtest/                     Synthetic + historical replay
├── settings/                     Grok key
├── health/                       Risk + execution dashboard
├── real/                         Warnings (placeholder server status)
└── api/                          REST (see STATUS.md)
```

## Key Files

| File | Role |
|------|------|
| `lib/runner/engine.ts` | 24/7 loop |
| `lib/runner/book-cache.ts` | Per-cycle deduplicated books |
| `lib/paper/ledger.ts` | Cash ledger + realized PnL |
| `lib/paper/mark-to-market.ts` | Live position marks |
| `lib/paper/risk-state.ts` | Paper → risk manager bridge |
| `lib/risk/sizing.ts` | USD ↔ shares conversion |
| `lib/execution/execution-manager.ts` | Execution decisions |
| `lib/execution/paper-simulator.ts` | Paper fills |
| `lib/execution/real-executor.ts` | Real orders |
| `lib/risk/portfolio-manager.ts` | Sizing + circuit breakers |
| `lib/data/historical.ts` | Snapshots + replay |
| `lib/db/schema.ts` | Schema source of truth |

## Testing

| Layer | Tool |
|-------|------|
| Lint | ESLint (CI) |
| Unit | Vitest — 57 tests, 15 files |
| Smoke | `scripts/smoke-test.mjs` — not in CI |
| E2E | Playwright (CI) |

## Deployment

Railway: `railway.toml`. Requires `DATABASE_URL` + `npm run db:push`.

See [OPERATIONS.md](./OPERATIONS.md) and [STATUS.md](./STATUS.md).
