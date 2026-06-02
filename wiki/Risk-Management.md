# Risk Management

**Status:** See [Project Status](Project-Status) for verified behavior (June 2, 2026).

Risk management is the most important part of this system. This page separates design intent from verified behavior.

---

## Core beliefs

- Most edges are small or illusory after fees and slippage.
- Survival and consistency beat home runs.
- The system must protect itself when it is wrong.

---

## Risk layers

### 1. Portfolio level (`PortfolioRiskManager`)

**Runs:** `calculateSafeSize()` is called from runner and real executor.

**Verified:** Each runner cycle calls `loadPaperRiskState` → `setCyclePortfolioState` so sizing uses actual paper ledger state (equity, exposure, positions) — not placeholder heuristics.

**Sizing flow:** Kelly returns USD target; `computeFinalShareSize` converts to shares in runner and real executor.

**Caveat:** Daily P&L baseline uses cost basis for open positions; intraday MTM can skew the daily loss breaker slightly.

### 2. Risk modes (`RiskModeManager`)

**Runs:** NORMAL / DEFENSIVE / EMERGENCY while runner process is active.

**Behavior verified:** Runner reduces markets evaluated and filters strategies in DEFENSIVE/EMERGENCY modes.

**Persistence:** Transitions are durable via `system_state` (along with kill switch and risk snapshots).

| Mode | Behavior |
|------|----------|
| **NORMAL** | Full market scan, all active strategies |
| **DEFENSIVE** | Fewer markets, weaker strategies filtered, reduced sizing |
| **EMERGENCY** | Minimal activity, aggressive throttling |

View current mode on `/health`.

### 3. Edge decay

**Verified:** `recordWindow()` is fed from per-strategy paper PnL each runner cycle. Poor recent performance contributes to risk mode transitions alongside health/adverse/unhealthy counts.

**Limitation:** Edge decay windows are in-memory — reset on restart until re-fed from new cycles.

### 4. Temporary adjustments

**Verified:** Grok can propose global risk reduction or strategy downweighting. `incrementRunCount()` runs at the start of each `runOnce()` so adjustments expire as designed.

### 5. Per-market execution health (`ExecutionManager`)

**Runs:** Tracks fill quality in memory; runner applies health multiplier.

**Limitation:** In-memory only; lost on restart.

### 6. Strategy allocator

**Verified:** Weights strategies by recent PnL + activity (not just signal/fill counts).

### 7. Runner self-protection

Combines risk mode, health multiplier, edge decay, and portfolio sizing on each evaluation cycle. Exit signals bypass breakers by design.

---

## Recommended settings (conservative)

For real capital (when execution path is validated):

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
| Disable real execution | Leave `SNIPER_ENABLE_REAL_EXECUTION` unset or `false`; or call `disableRealExecution()` |
| Emergency | Stop runner + disable real env flag |

Durable kill switch and risk state persist in `system_state` across restarts.

See [Operations](Operations) for 24/7 monitoring routine.

---

## Related pages

- [Execution Layer](Execution-Layer)
- [Operations](Operations)
- [Known Issues](Known-Issues-and-Roadmap)
