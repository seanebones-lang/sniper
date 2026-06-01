# Standout Features

This document highlights what makes Sniper a particularly comprehensive and advantageous 24/7 prediction market trading system.

## 1. True Self-Protection & Autonomy

Most trading systems only *warn* you when things go wrong. Sniper actively protects itself:

- **Risk Modes** (NORMAL / DEFENSIVE / EMERGENCY) that automatically change real behavior:
  - Strategy selection
  - Number of markets evaluated
  - Position sizing aggressiveness
- Per-market execution health tracking with automatic downweighting.
- Edge decay detection that feeds directly into risk decisions.
- Temporary adjustments from the intelligence layer that auto-expire.

## 2. Professional Research Flywheel

The system is designed to continuously improve itself:

- Rich historical order book snapshot collection with advanced microstructure features.
- Powerful replay engine (with optional realistic passive fill simulation).
- Grok Research Agent that produces **structured, actionable recommendations**.
- Proposals can be turned into versioned **Strategy Variants**.
- Variants can be directly compared against base strategies on identical historical data.
- Recommendations can be manually applied or **auto-applied** with full tracking of outcomes.

This creates a real closed loop: Data → Analysis → Action → Measurement → Better Analysis.

## 3. Execution Intelligence (Not Just Signal Generation)

Execution quality is treated as a first-class citizen:

- Central `ExecutionManager` that decides passive vs aggressive for every signal.
- Adverse selection detection with response logic.
- Order lifecycle management (`handleBookUpdate`, `manageRestingOrders`).
- Execution quality scoring that influences risk decisions.
- Realistic passive fill simulation for trustworthy backtesting and research.

## 4. Multi-Layer Professional Risk

- `PortfolioRiskManager` with fractional Kelly, category limits, and concentration penalties.
- Dynamic Strategy Allocator that sizes strategies based on recent performance.
- Risk Mode system that changes *what* the system trades, not just how much.
- Real-time health-based throttling at both market and global levels.

## 5. Excellent Observability

- Rich `/health` dashboard showing:
  - Current risk mode + active behavioral restrictions
  - Execution health and slippage
  - Recent Grok recommendations with status
  - Active temporary adjustments
- Structured audit events for every important decision.
- Edge decay monitoring.
- Telegram alerts for important events.

## 6. Practical 24/7 Design

- Paper mode is the default and primary operating mode.
- Everything is heavily auditable.
- Strong separation between research and live execution.
- Designed to run unattended for long periods with self-protection mechanisms.

---

This combination of **professional risk**, **real self-protection**, **high-quality research infrastructure**, and **closed-loop intelligence** is what makes Sniper significantly more advanced than typical prediction market automation projects.
