# Risk Management

**Status:** See [Project Status](Project-Status) for verified behavior.

Risk management is the most important part of this system — but several documented behaviors are **partially implemented**. This page separates design intent from verified behavior.

---

## Core beliefs

- Most edges are small or illusory after fees and slippage.
- Survival and consistency beat home runs.
- The system must protect itself when it is wrong.

---

## Risk layers

### 1. Portfolio level (`PortfolioRiskManager`)

**Runs:** `calculateSafeSize()` is called from runner and real executor.

**Limitation:** `getCurrentPortfolioState()` uses rough heuristics — `dailyPnl` placeholder is 0, category exposures fabricated, `positions` table not queried. Sizing logic executes but input state is approximate.

### 2. Risk modes (`RiskModeManager`)

**Runs:** NORMAL / DEFENSIVE / EMERGENCY while runner process is active.

**Behavior verified:** Runner reduces markets evaluated and filters strategies in DEFENSIVE/EMERGENCY modes.

**Limitations:**
- State is **in-memory** — resets on restart.
- Edge decay input **not wired** — transitions use health/adverse/unhealthy counts only.

| Mode | Behavior |
|------|----------|
| **NORMAL** | Full market scan, all active strategies |
| **DEFENSIVE** | Fewer markets, weaker strategies filtered, reduced sizing |
| **EMERGENCY** | Minimal activity, aggressive throttling |

View current mode on `/health`.

### 3. Temporary adjustments

**Design:** Grok can propose global risk reduction or strategy downweighting with expiration.

**Limitation:** `incrementRunCount()` is **never called** — adjustments do not expire as designed.

### 4. Per-market execution health (`ExecutionManager`)

**Runs:** Tracks fill quality in memory; runner applies health multiplier.

**Limitation:** In-memory only; lost on restart.

### 5. Strategy allocator + edge decay

**Allocator runs** but uses signal/fill **counts**, not PnL or execution quality.

**Edge decay monitor** exists but is **never fed data**.

### 6. Runner self-protection

Combines risk mode, health multiplier, and portfolio sizing on each evaluation cycle — **when** the signal/fill path succeeds. Today automated fills are blocked by FK issue.

---

## Recommended settings (conservative)

For real capital (when execution path is fixed):

| Setting | Value |
|---------|-------|
| `kellyFraction` | 0.15–0.25 |
| Category limits | Strict |
| Health throttle threshold | ~0.5 |

Paper mode can be more aggressive for research.

---

## Kill switches

| Action | How |
|--------|-----|
| Stop runner | `/strategies` → Stop button |
| Pause strategy | Toggle `isActive` on Strategies page |
| Disable real execution | Leave `SNIPER_ENABLE_REAL_EXECUTION` unset or `false` |
| Emergency | Stop runner + disable real env flag |

See [Operations](Operations) for 24/7 monitoring routine.

---

## Related pages

- [Execution Layer](Execution-Layer)
- [Operations](Operations)
- [Known Issues](Known-Issues-and-Roadmap)
