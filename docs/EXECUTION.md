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

**Gate:** `SNIPER_ENABLE_REAL_EXECUTION=true` + strategy `paperOnly: false` + kill switch + risk checks (sync per-trade + async real-exposure) + ExecutionManager decision + single-runner lock.

| Platform | Status |
|----------|--------|
| Polymarket | Coded (`placePolymarketLimitOrder` entries, `placePolymarketMarketOrder` for marketable entries/exits); requires `POLYMARKET_PRIVATE_KEY`; not CI-tested with live keys |
| Kalshi | Coded (`kalshi-trading.ts`); requires `KALSHI_ACCESS_KEY` / `KALSHI_RSA_PRIVATE_KEY` |

Real sizing uses USD cap → shares conversion (same as paper runner). **Exits are never re-risk-capped** — they liquidate the full open position.

### Real-position exit lifecycle (June 3, 2026)

This closes the previous critical defect where real fills were trapped (no exit ever emitted):

1. **Attribution:** `placeRealOrder` writes `real_trades.signalId`, linking each fill to its strategy.
2. **Open positions:** `getRealOpenPositionsByStrategy()` (`lib/execution/real-positions.ts`) aggregates filled `real_trades` joined to `signals` into net positions (weighted-avg entry, earliest `openedAt`).
3. **Exit emission:** for `paperOnly:false` strategies the runner populates `openByMarket` from **real** positions, so `evaluateExitSignal` fires take-profit / stop-loss / max-hold and emits real SELLs.
4. **Marketable exits:** exit SELLs are forced to `TAKE_AGGRESSIVE` and submitted as a Polymarket **FAK market order** (`amount` = shares) so they cross immediately; a missing/one-sided book cannot strand the position.
5. **No double-sell / retry spam:** a per-market in-flight guard (skip when a `pending` real order exists), a `signalId` idempotency check, and cooldown-on-failed-entry (exits exempt) prevent duplicate submissions.

### Order types

| Intent | Order |
|--------|-------|
| Quick-flip entry (take liquidity) | Market **FOK** (all-or-nothing), `amount` = USD |
| Passive entry | Limit (post-only when ExecutionManager says POST_PASSIVE) |
| Exit (take-profit / stop / max-hold) | Market **FAK** (fill what's available, cancel rest), `amount` = shares |

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
| Real Polymarket / Kalshi orders | Coded, gated, untested in CI with live keys |
| Real-position exit lifecycle (buy→exit) | Yes (unit-tested at the decision level) |
| Single-runner lock | Yes |
| Real exposure ceiling | Yes (`riskEngine.checkRealExposure`) |
| Queue-position simulation | No |
| Replay realistic passive fills | No (UI flag only) |

See [CONTRIBUTING.md](../CONTRIBUTING.md) for remaining execution tasks.
