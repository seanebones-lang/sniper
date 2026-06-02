# Risk Philosophy & System

**Status:** [STATUS.md](./STATUS.md)

Risk management is the most important part of this system — but several documented behaviors are **partially implemented**. This doc separates design intent from verified behavior.

## Core Beliefs

- Most edges are small or illusory after fees and slippage.
- Survival and consistency beat home runs.
- The system must protect itself when it is wrong.

## Risk Layers

### 1. Portfolio Level (`PortfolioRiskManager`)

**Runs:** `calculateSafeSize()` is called from runner and real executor.

**Limitation:** `getCurrentPortfolioState()` uses rough heuristics — `dailyPnl` placeholder is 0, category exposures fabricated, `positions` table not queried. Sizing logic executes but input state is approximate.

### 2. Risk Modes (`RiskModeManager`)

**Runs:** NORMAL / DEFENSIVE / EMERGENCY while runner process is active.

**Behavior verified:** Runner reduces markets evaluated and filters strategies in DEFENSIVE/EMERGENCY modes.

**Limitations:**
- State is **in-memory** — resets on restart.
- Edge decay input **not wired** (`recordWindow()` never called) — transitions use health/adverse/unhealthy counts only.

### 3. Temporary Adjustments

**Design:** Grok can propose global risk reduction or strategy downweighting with expiration.

**Limitation:** `incrementRunCount()` is **never called** — adjustments do not expire as designed.

### 4. Per-Market Execution Health (`ExecutionManager`)

**Runs:** Tracks fill quality in memory; runner applies health multiplier.

**Limitation:** In-memory only; lost on restart.

### 5. Strategy Allocator + Edge Decay

**Allocator runs** but uses signal/fill **counts**, not PnL or execution quality.

**Edge decay monitor** exists but is **never fed data**.

### 6. Runner Self-Protection

Combines risk mode, health multiplier, and portfolio sizing on each evaluation cycle — **when** the signal/fill path succeeds. Today automated fills are blocked by FK issue (see STATUS.md).

## Recommended Settings (Conservative)

For real capital (when implemented path is fixed):

- `kellyFraction: 0.15–0.25`
- Strict category limits
- Health throttle threshold ~0.5

Paper mode can be more aggressive for research.

## Related Docs

- [STATUS.md](./STATUS.md) — verified matrix
- [EXECUTION.md](./EXECUTION.md) — execution health
- [OPERATIONS.md](./OPERATIONS.md) — real-money checklist
