# Execution Layer

**Status:** [STATUS.md](./STATUS.md)

## Philosophy

Execution quality often determines whether a theoretical edge survives fees, adverse selection, and latency.

## ExecutionManager

**Location:** `lib/execution/execution-manager.ts`

In-memory brain for passive vs aggressive decisions, adverse selection heuristics, and per-market health.

**Used by:** paper simulator (book + imbalance from runner), real executor, runner health throttle.

**Not fully wired:** continuous resting-order management from live WS feeds in the runner loop (REST books via `CycleBookCache`).

## Paper Execution

| Path | Status |
|------|--------|
| Manual fill via `POST /api/paper/fill` | **Works** → `paper_trades` |
| Manual fill via market detail UI | **Works** |
| Runner automated fill | **Works** (signal linked via `signalId`) |
| Immediate fill mode | Works for exits and aggressive entries |
| Book imbalance + regime in simulator | **Works** (passed from runner snapshots) |

Fee model: ~5 bps in simulator.

## Real Execution

**Gate:** `SNIPER_ENABLE_REAL_EXECUTION=true` + strategy `paperOnly: false` + kill switch + risk checks + ExecutionManager decision.

| Platform | Status |
|----------|--------|
| Polymarket | Coded (`placePolymarketLimitOrder`); requires `POLYMARKET_PRIVATE_KEY`; not CI-tested |
| Kalshi | Coded (`kalshi-trading.ts`); requires `KALSHI_ACCESS_KEY` / `KALSHI_RSA_PRIVATE_KEY` |

Real sizing uses USD cap → shares conversion (same as paper runner).

## Smart Router

`lib/execution/smart-router.ts` — passive/aggressive/wait from book, imbalance, signal age, real vs paper flag.

## Health Dashboard

`/health` and `/api/health` expose execution manager state, runner cycle timing, and recent audit events. Execution fill history resets on process restart.

## Verified vs Planned

| Capability | Verified |
|------------|----------|
| ExecutionManager decision logic | Yes |
| Adverse selection heuristics | Yes |
| Per-market health in runner throttle | Yes |
| Manual + automated paper fills to DB | Yes |
| Real Polymarket / Kalshi orders | Coded, gated, untested in CI |
| Queue-position simulation | No |
| Replay realistic passive fills | No (UI flag only) |

See [CONTRIBUTING.md](../CONTRIBUTING.md) for remaining execution tasks.
