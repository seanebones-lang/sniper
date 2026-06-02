# Execution Layer

**Status:** [STATUS.md](./STATUS.md)

## Philosophy

Execution quality often determines whether a theoretical edge survives fees, adverse selection, and latency.

## ExecutionManager

**Location:** `lib/execution/execution-manager.ts`

In-memory brain for passive vs aggressive decisions, adverse selection heuristics, and per-market health.

**Used by:** paper simulator (when book available), real executor, runner health throttle.

**Not fully wired:** continuous resting-order management from live WS feeds in the runner loop.

## Paper Execution

| Path | Status |
|------|--------|
| Manual fill via `POST /api/paper/fill` | **Works** → `paper_trades` |
| Manual fill via market detail UI | **Works** |
| Runner automated fill | **Broken** (signal FK — see STATUS.md) |
| Immediate fill mode | Works (bypasses ExecutionManager when no book) |

Fee model: ~5 bps in simulator.

## Real Execution

**Gate:** `SNIPER_ENABLE_REAL_EXECUTION=true` + strategy `paperOnly: false` + risk checks + ExecutionManager decision.

| Platform | Status |
|----------|--------|
| Polymarket | Coded (`placePolymarketLimitOrder`); requires `POLYMARKET_PRIVATE_KEY`; not CI-tested |
| Kalshi | Returns "not yet implemented" |

## Smart Router

`lib/execution/smart-router.ts` — passive/aggressive/wait from book, imbalance, signal age, real vs paper flag.

## Health Dashboard

`/health` reads in-process execution manager state and API health endpoint. Resets on process restart.

## Verified vs Planned

| Capability | Verified |
|------------|----------|
| ExecutionManager decision logic | Yes |
| Adverse selection heuristics | Yes |
| Per-market health in runner throttle | Yes (in-process) |
| Manual paper fills to DB | Yes |
| Runner automated paper fills | No (FK blocker) |
| Real Polymarket orders | Coded, gated, untested in CI |
| Real Kalshi orders | No |
| Queue-position simulation | No |
| Replay realistic passive fills | No (UI only) |

See [CONTRIBUTING.md](../CONTRIBUTING.md) for execution-related tasks.
