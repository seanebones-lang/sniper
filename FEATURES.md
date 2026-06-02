# Standout Features

This document highlights what makes Sniper a comprehensive 24/7 prediction market research + execution system (June 2026).

## 1. True Self-Protection & Autonomy

Most trading systems only *warn* you when things go wrong. Sniper actively protects itself:

- **Risk Modes** (NORMAL / DEFENSIVE / EMERGENCY) that automatically change real behavior:
  - Strategy selection
  - Number of markets evaluated
  - Position sizing aggressiveness
- Per-market execution health tracking with automatic downweighting.
- **Edge decay detection** fed from per-strategy paper PnL each runner cycle.
- Temporary adjustments from the intelligence layer that auto-expire via `incrementRunCount()`.
- **Durable risk state**: Kill switch, risk mode, exposure, maxDrawdown, and execution health persist via `system_state`.
- **Exit bypass**: take-profit/stop-loss sells are not blocked by exposure circuit breakers.

## 2. Professional Research Flywheel

The system is designed to continuously improve itself:

- Rich historical order book snapshot collection with regime labels from `extractFeaturesFromRecentSnapshots`.
- Historical replay engine (realistic passive fill mode still TODO).
- Grok Research Agent with **structured proposal parsing** (JSON/`PROPOSALS` blocks).
- Per-strategy PnL attribution joining `paper_trades` → `signals`.
- PnL-weighted dynamic strategy allocator.
- RECOMMENDED ACTIONS auto-apply with full audit trail.

Closed loop: Data → Analysis → Action → Measurement → Better Analysis.

## 3. Execution Intelligence (Not Just Signal Generation)

Execution quality is treated as a first-class citizen:

- Central `ExecutionManager` that decides passive vs aggressive for every signal.
- Paper simulator receives **live book imbalance and regime** from the runner.
- Adverse selection detection with response logic.
- Execution quality scoring that influences risk decisions.
- Per-cycle deduplicated book cache for faster, consistent pricing.

## 4. Multi-Layer Professional Risk

- `PortfolioRiskManager` with fractional Kelly (**USD caps** → share conversion), category limits, and concentration penalties.
- Paper ledger + MTM unified with risk sizing via `loadPaperRiskState()`.
- Dynamic Strategy Allocator sized by recent PnL + activity.
- Risk Mode system that changes *what* the system trades, not just how much.
- Real-time health-based throttling at both market and global levels.

## 5. Excellent Observability

- Rich `/health` dashboard and `/api/health` JSON:
  - Current risk mode + behavioral restrictions
  - Execution health and slippage
  - Runner cycle duration and last cycle diagnostics
  - Recent Grok recommendations
  - Active temporary adjustments
  - Recent audit events
- Live paper P&L on `/dashboard` and `/paper` (ledger + MTM).
- Lightweight `/api/paper/pnl` for polling.
- Telegram alerts for important events.

## 6. Practical 24/7 Design

- Paper mode is the default and primary operating mode.
- Runner overlap guard + adaptive interval (4–12s).
- Everything is heavily auditable.
- Strong separation between research and live execution.
- Designed to run unattended for long periods with self-protection mechanisms.

---

This combination of **professional risk**, **real self-protection**, **accurate paper accounting**, **high-quality research infrastructure**, and **closed-loop intelligence** is what makes Sniper significantly more advanced than typical prediction market automation projects.
