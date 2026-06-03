# Risk Philosophy & System

**Status:** [STATUS.md](./STATUS.md)

Risk management is the most important part of this system. This doc describes design intent and **verified behavior** as of June 2026.

## Core Beliefs

- Most edges are small or illusory after fees and slippage.
- Survival and consistency beat home runs.
- The system must protect itself when it is wrong.

## Risk Layers

### 1. Portfolio Level (`PortfolioRiskManager`)

**Runs:** `calculateSafeSize()` on every runner signal and real order.

**Verified (June 2026):**
- Paper mode loads state from `loadPaperRiskState()` — cash ledger + MTM exposure + daily PnL + category buckets.
- State cached per runner cycle via `setCyclePortfolioState()`; refreshed after paper fills.
- Kelly sizing returns **USD**; runner converts to shares via `computeFinalShareSize()`.
- **Exit signals bypass** exposure/daily-loss/drawdown circuit breakers so positions can be closed.
- **Drawdown breaker is recoverable (June 3, 2026):** the peak bankroll is an all-time high-water mark that persists across cycles, and current drawdown is measured against it each cycle — so the breaker engages during a real drawdown and *releases* when equity recovers (previously it was reset to 0 every cycle, which effectively disabled it). The peak is restored on startup via `restoreDrawdownState()`.

**Limitation:** Daily P&L baseline uses start-of-day cost basis for open positions (not MTM), which can slightly skew the daily loss breaker overnight.

### 1b. Real exposure (`riskEngine`)

For real money, `riskEngine.checkRealExposure()` enforces total + per-market USD ceilings against actual live holdings (`positions` + still-`pending` `real_trades`). Runs as an async gate in `placeRealOrder` for entries; **exits are exempt**. The sync `checkRisk()` per-trade gate (size + daily-loss breaker) still runs first on the hot path. Daily-loss tracking is restored on startup via `riskEngine.restoreDailyLoss()`.

### 2. Risk Modes (`RiskModeManager`)

**Runs:** NORMAL / DEFENSIVE / EMERGENCY while runner is active.

**Verified:** Runner reduces markets evaluated, filters strategies, and applies mode multipliers. Transitions persisted to `system_state`.

**Restart safety (June 3, 2026):** the persisted mode is now **restored** on startup (`restoreState`), and the runner **escalates to at least DEFENSIVE** if the last execution-health summary was poor (`escalateAtLeast`) so it does not oversize before fresh metrics rebuild.

### 2c. Single-runner lock

A `system_state` lease + heartbeat (`tryAcquireRunnerLock` / `releaseRunnerLock`) guarantees only one runner loop trades a given DB. It **fails closed** (refuses to start) when real execution is enabled, and fails open for paper so a transient DB blip doesn't halt research. The lease is refreshed every cycle; losing it stops the loop.

### 3. Temporary Adjustments

**Verified:** Grok auto-apply creates global/strategy downweights. `incrementRunCount()` runs each cycle; `cleanupExpiredAdjustments()` expires them.

### 4. Per-Market Execution Health (`ExecutionManager`)

**Runs:** Fill quality tracked in memory; runner applies health multiplier per market.

**Restart behavior (June 3, 2026):** in-memory fill history is still lost on restart, but (a) startup hydration/replay no longer feeds fake fills into the health metrics (`skipExecutionTracking`), and (b) if the last persisted health summary was poor the runner starts DEFENSIVE until real fills rebuild the picture.

### 5. Strategy Allocator + Edge Decay

**Allocator:** Weights strategies by recent PnL + activity (`getDynamicAllocations`).

**Edge decay:** `recordWindow()` fed each cycle from per-strategy paper PnL (`computeStrategyPnlWindows`).

### 6. Runner Self-Protection

Combines risk mode, Grok global downweight × mode multiplier, health throttle, allocator, and portfolio sizing on each signal.

## Recommended Settings (Conservative)

For real capital:

- `kellyFraction: 0.15–0.25`
- Strict category limits
- Health throttle threshold ~0.5
- Extended paper soak with `scripts/diagnose-paper-pnl.ts`

Paper mode can be more aggressive for research.

## Related Docs

- [STATUS.md](./STATUS.md) — verified matrix
- [EXECUTION.md](./EXECUTION.md) — execution health
- [OPERATIONS.md](./OPERATIONS.md) — real-money checklist
