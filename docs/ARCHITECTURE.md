# Architecture

Sniper is a **research + execution platform** first, trading bot second.

**Status:** See [STATUS.md](./STATUS.md) for verified capabilities and blockers.

## High-Level Layers

1. **Data Layer**
   - REST: Gamma API + Polymarket CLOB, Kalshi trade API
   - In-memory cache: `lib/markets.ts` (~25s TTL) — **not** synced to `markets` DB table
   - WebSocket: Polymarket client used on market detail page only; Kalshi WS client exists but is unused in UI/runner
   - Historical: `market_snapshots` (written by runner when books available)

2. **Research Layer**
   - Replay: `lib/data/historical.ts` (`realisticPassiveFills` param exists but is **not implemented** in replay logic)
   - Features: `lib/data/features.ts`
   - Grok agent: `lib/research/grok-agent.ts` (text output; structured `proposals[]` not parsed)
   - Variants: `lib/strategies/variants.ts` (**in-memory**, lost on restart)
   - UI: `/backtest`

3. **Strategy Layer**
   - Four strategies in `lib/strategies/`
   - Allocator: `lib/strategies/allocator.ts` (signal/fill counts, not execution quality)
   - Regime: via `StrategyContext.regime` and snapshot features

4. **Risk Layer**
   - `PortfolioRiskManager` — Kelly sizing; portfolio state uses **placeholders** (no live `positions` DB)
   - `RiskModeManager` — NORMAL / DEFENSIVE / EMERGENCY (**in-process**, resets on restart)
   - `TemporaryAdjustments` — expiration **broken** (`incrementRunCount` never called)
   - Edge decay monitor — **not fed data** (`recordWindow` never called)
   - Per-market execution health from ExecutionManager (in-memory)

5. **Execution Layer**
   - `ExecutionManager` — passive/aggressive, adverse selection heuristics
   - `PaperSimulator` — manual immediate fill + managed path
   - `RealExecutor` — Polymarket only; gated

6. **Runner**
   - `lib/runner/engine.ts` — ~12s interval via API
   - Fetches REST order books, saves snapshots, evaluates strategies
   - **Automated signal insert → fill path broken** until markets DB sync (see STATUS.md)
   - Periodic Grok (probabilistic timing when enabled)

7. **Observability**
   - `audit_events` in PostgreSQL
   - `/api/health`, `/health` UI
   - Telegram (optional)
   - Performance attribution API (**placeholder** logic)

## Application Structure

```
app/
├── page.tsx, dashboard/          Landing + nav
├── markets/                      Discovery + detail (Polymarket WS on detail)
├── strategies/                   CRUD + runner control
├── backtest/                     Synthetic + historical replay
├── settings/                     Grok key (file or env)
├── health/                       Risk + execution dashboard
├── real/                         Warnings (placeholder server status)
└── api/                          REST (see STATUS.md)
```

## Design Principles

- **Paper first, always.** Real money requires env flag + non-paper strategy + risk gates.
- **Auditable.** Signals and audit events intended to capture reasons (when FK path works).
- **Self-protecting.** Risk modes and health throttle — while process is running.
- **Honest scope.** Document what works vs what is stubbed.

## Key Files

| File | Role |
|------|------|
| `lib/runner/engine.ts` | 24/7 loop |
| `lib/execution/execution-manager.ts` | Execution decisions |
| `lib/execution/paper-simulator.ts` | Paper fills |
| `lib/execution/real-executor.ts` | Real orders (Polymarket) |
| `lib/risk/portfolio-manager.ts` | Sizing (approximate state) |
| `lib/clients/polymarket.ts` | Gamma + CLOB |
| `lib/data/historical.ts` | Snapshots + replay |
| `lib/db/schema.ts` | Schema source of truth |

## Testing

| Layer | Tool |
|-------|------|
| Lint | ESLint (CI) |
| Unit | Vitest — 8 tests, 2 files |
| Smoke | `scripts/smoke-test.mjs` — not in CI |
| E2E | Playwright — 14 tests (CI) |

## Deployment

Railway: `railway.toml`. Requires `DATABASE_URL` + `npm run db:push`.

See [OPERATIONS.md](./OPERATIONS.md) and [STATUS.md](./STATUS.md).
