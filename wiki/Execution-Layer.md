# Execution Layer

**Status:** See [Project Status](Project-Status) (June 2, 2026).

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

**Not fully wired:** continuous resting-order management from live WS feeds in the runner loop (runner uses REST books via `book-cache.ts`).

---

## Paper execution

| Path | Status |
|------|--------|
| Manual fill via `POST /api/paper/fill` | **Works** → `paper_trades` |
| Manual fill via market detail UI | **Works** |
| Runner automated fill | **Works** — `ensureMarketRecord` before signal insert |
| P&L (ledger + MTM) | **Works** — dashboard, `/paper`, `/api/paper/pnl` |
| Immediate fill mode | Works (bypasses ExecutionManager when no book) |

Fee model: ~5 bps in simulator.

### Paper fill workflows

**Automated (recommended for strategy testing):**

1. Create and activate strategies on `/strategies`
2. Start the runner
3. Runner evaluates markets, inserts signals, and fills via paper simulator
4. View P&L on `/dashboard`, `/paper`, or `GET /api/paper/pnl`

**Manual:**

1. Navigate to `/markets`
2. Open a market detail page
3. Use the paper fill controls with size and side
4. Fill persists to `paper_trades` in PostgreSQL

---

## Real execution

**Gate:** All of the following must be true:

1. `SNIPER_ENABLE_REAL_EXECUTION=true` (server env)
2. Strategy has `paperOnly: false` (DB field; no UI toggle yet)
3. `isRealExecutionAllowed()` — env override + durable kill switch in `system_state`
4. Risk checks pass (including maxDrawdown)
5. ExecutionManager approves the decision

| Platform | Status |
|----------|--------|
| Polymarket | Coded (`placePolymarketLimitOrder`); requires `POLYMARKET_PRIVATE_KEY`; not CI-tested |
| Kalshi | Coded (`kalshi-trading.ts` + reconciliation); requires Kalshi API keys; not CI-tested |

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
- Runner cycle timing

Execution health resets on process restart; kill switch and risk mode persist via `system_state`.

---

## Verified vs planned

| Capability | Verified |
|------------|----------|
| ExecutionManager decision logic | Yes |
| Adverse selection heuristics | Yes |
| Per-market health in runner throttle | Yes (in-process) |
| Manual paper fills to DB | Yes |
| Runner automated paper fills | Yes |
| Paper P&L ledger + MTM | Yes |
| Real Polymarket orders | Coded, gated, untested in CI |
| Real Kalshi orders | Coded, gated, untested in CI |
| Queue-position simulation | No |
| Replay realistic passive fills | No (UI only) |
| Runner WS book feed | No (REST only) |

---

## Related pages

- [Risk Management](Risk-Management)
- [Environment Variables](Environment-Variables) — real execution secrets
- [Contributing](Contributing) — execution-related tasks
