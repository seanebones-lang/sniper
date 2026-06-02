# Execution Layer

**Status:** See [Project Status](Project-Status).

---

## Philosophy

Execution quality often determines whether a theoretical edge survives fees, adverse selection, and latency.

---

## ExecutionManager

**Location:** `lib/execution/execution-manager.ts`

In-memory brain for:
- Passive vs aggressive decisions
- Adverse selection heuristics
- Per-market health scores

**Used by:** paper simulator (when book available), real executor, runner health throttle.

**Not fully wired:** continuous resting-order management from live WS feeds in the runner loop.

---

## Paper execution

| Path | Status |
|------|--------|
| Manual fill via `POST /api/paper/fill` | **Works** → `paper_trades` |
| Manual fill via market detail UI | **Works** |
| Runner automated fill | **Broken** (signal FK — see [Known Issues](Known-Issues-and-Roadmap)) |
| Immediate fill mode | Works (bypasses ExecutionManager when no book) |

Fee model: ~5 bps in simulator.

### Manual paper fill workflow

1. Navigate to `/markets`
2. Open a market detail page
3. Use the paper fill controls with size and side
4. Fill persists to `paper_trades` in PostgreSQL

This is the **recommended path** for paper trading today.

---

## Real execution

**Gate:** All of the following must be true:

1. `SNIPER_ENABLE_REAL_EXECUTION=true` (server env)
2. Strategy has `paperOnly: false` (DB field; no UI toggle yet)
3. Risk checks pass
4. ExecutionManager approves the decision

| Platform | Status |
|----------|--------|
| Polymarket | Coded (`placePolymarketLimitOrder`); requires `POLYMARKET_PRIVATE_KEY`; not CI-tested |
| Kalshi | Returns "not yet implemented" |

See `/real` for the confirmation gate UI (placeholder server status).

---

## Smart router

**File:** `lib/execution/smart-router.ts`

Decides passive / aggressive / wait from:
- Order book state
- Imbalance
- Signal age
- Real vs paper flag

---

## Health dashboard

`/health` reads in-process execution manager state and the `/api/health` endpoint.

Metrics include:
- System health score
- Average slippage (recent)
- Unhealthy markets count

State resets on process restart.

---

## Verified vs planned

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

---

## Related pages

- [Risk Management](Risk-Management)
- [Environment Variables](Environment-Variables) — real execution secrets
- [Contributing](Contributing) — execution-related tasks
