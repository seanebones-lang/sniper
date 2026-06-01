# Changelog

All notable changes to the Sniper project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- **Risk Mode System** (`NORMAL` / `DEFENSIVE` / `EMERGENCY`)
  - Explicit risk modes that automatically change runner behavior (strategy filtering, market limits, sizing conservatism).
  - `RiskModeManager` with automatic evaluation based on system health, adverse execution rate, and edge decay.
- **Temporary Adjustments System**
  - Grok recommendations can now create temporary risk changes (global risk reduction, strategy downweighting) that auto-expire.
- **ExecutionManager v3**
  - Advanced passive order management (`handleBookUpdate`, `manageRestingOrders`).
  - Per-market execution health tracking with automatic downweighting.
  - Adverse selection response logic.
- **Automated Intelligence Layer**
  - Scheduled Grok Research Agent calls with rich context.
  - Structured, actionable recommendations with parsing and lifecycle tracking.
  - One-click + auto-application of safe recommendations.
- **Edge Decay Monitoring**
  - Dedicated monitor that detects strategy degradation and feeds into risk decisions.
- **Realistic Passive Fill Simulation**
  - Significantly improved passive order behavior in the Paper Simulator.
  - Optional realistic fill mode in the historical replay engine for higher research fidelity.
- **Strategy Health Dashboard** (`/health`)
  - Live view of risk mode + active restrictions, execution quality, AI recommendations, and temporary adjustments.
- Comprehensive documentation overhaul (README + full `docs/` suite).

### Changed
- Runner self-protection is now active and behavioral (not just logging).
- Research flywheel is now closed-loop with measurable recommendation outcomes.

---

## [0.2.0] - 2026-06

### Added
- Full Risk Mode behavioral system.
- Grok Research Agent with structured proposals and auto-applicable temporary adjustments.
- Realistic passive fill simulation in paper and replay.
- ExecutionManager with order lifecycle and health tracking.
- Edge decay monitoring.

### Documentation
- Major updates to all core documentation.

---

## [0.1.0] - Initial Development

- Initial architecture: Next.js + Drizzle + Railway.
- Multi-venue data ingestion (Polymarket + Kalshi) with WebSockets.
- Paper trading simulator.
- Multiple trading strategies.
- Professional risk management foundation.
- Grok integration for research.
- Replay engine and variants system.
- Basic observability and alerting.
