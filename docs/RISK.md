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

**Limitation:** Daily P&L baseline uses start-of-day cost basis for open positions (not MTM), which can slightly skew the daily loss breaker overnight.

### 2. Risk Modes (`RiskModeManager`)

**Runs:** NORMAL / DEFENSIVE / EMERGENCY while runner is active.

**Verified:** Runner reduces markets evaluated, filters strategies, and applies mode multipliers. Transitions persisted to `system_state`.

**Limitation:** In-process mode state resets on restart until recovered from durable snapshot.

### 3. Temporary Adjustments

**Verified:** Grok auto-apply creates global/strategy downweights. `incrementRunCount()` runs each cycle; `cleanupExpiredAdjustments()` expires them.

### 4. Per-Market Execution Health (`ExecutionManager`)

**Runs:** Fill quality tracked in memory; runner applies health multiplier per market.

**Limitation:** In-memory history lost on restart.

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
