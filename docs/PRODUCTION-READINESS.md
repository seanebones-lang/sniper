# Sniper — Production Readiness Review

**Date:** June 2026  
**Version:** Post 4-Phase Production Readiness Push  
**Status:** Experimental / Hardening for Real Capital

This document provides an honest assessment of Sniper’s readiness to manage real capital 24/7. It is intended as a companion to [docs/STATUS.md](STATUS.md).

---

## Executive Summary

**Overall Assessment (June 2026): Not yet ready for unsupervised real capital deployment.**

Sniper has made **substantial and meaningful progress** toward being a responsible system for real money. The most dangerous class of failure (loss of safety state on restart) has been directly addressed through durable risk snapshots and persistent kill switch / risk mode state.

However, the system remains **experimental** for real capital. Key gaps remain in reconciliation completeness (especially partial fills and Polymarket), real-time position accuracy, and high-stakes testing coverage.

**Current Verdict:**
- **Paper trading**: Production-ready and reliable.
- **Real capital with heavy human oversight + very small size**: Feasible with the current durability and risk layers.
- **Unsupervised or meaningful real capital**: Not recommended yet.

---

## Major Strengths (What Works Well)

| Area | Assessment | Key Evidence |
|------|------------|--------------|
| **State Durability** | Strong | `system_state` table + rich `risk_snapshot` system. Kill switch, risk mode, daily loss, execution health, and full risk posture now persist across restarts. Runner recovers and reacts to bad prior state. |
| **Risk Management Core** | Strong + Improving | `PortfolioRiskManager` with real position-driven exposure, category limits, and new maxDrawdown circuit breaker. |
| **Auditability** | Strong | Comprehensive `audit_events` coverage across runner, risk, execution, and reconciliation. |
| **ID Discipline** | Strong | `ensureMarket` / `ensureMarketRecord` usage is enforced and working. |
| **Kill Switch & Self-Protection** | Strong | Durable + multi-layered (env + runtime + recovery behavior). |
| **Process Discipline** | Strong | Strict gated verification + commit/push on every batch. |

---

## Remaining Gaps (Prioritized by Real Capital Risk)

### Critical (Blocks unsupervised real capital)

1. **Reconciliation Completeness**
   - Kalshi has active order + fill polling and calls `recordRealFill` on confirmed fills. Still needs stronger partial fill and fee handling.
   - Polymarket has basic open-order detection.
   - `recordRealFill` now defensively calls `ensureMarket` before writing positions.

2. **Real-Time Position & PnL Accuracy**
   - `getCurrentPortfolioState()` is much better but still relies on imperfect position data.
   - MaxDrawdown tracking is basic (peak bankroll only).
   - No live mark-to-market from exchanges in the risk layer.

3. **High-Stakes Testing Coverage**
   - 22 unit tests with good risk/durability coverage.
   - Very limited guarded integration or failure-injection tests for real execution paths.
   - E2E remains minimal.

### High (Significant operational risk)

4. **Observability & Alerting for Real Money**
   - `/api/health` now surfaces durable snapshots (good improvement).
   - Still lacks proactive alerting for high exposure, kill switch activation, or reconciliation failures.

5. **Deployment & Operational Resilience**
   - Single-instance assumption (Railway).
   - Limited graceful shutdown / state flushing.
   - No canary or blue/green deployment strategy for real-enabled instances.

### Medium

6. **Architecture & Complexity**
   - Runner remains a large orchestrator (~580 LOC).
   - Multiple in-memory managers still exist alongside the new durable layer.

7. **Research-to-Real Promotion Safety**
   - Grok agent + replay pipeline is powerful.
   - Transition from proposal → small real pilot → promotion lacks automated guardrails.

---

## Progress Summary (Recent 4-Phase Push)

**Phase 1 – Risk & Exposure**
- MaxDrawdown tracking + circuit breaker implemented.
- `getCurrentPortfolioState()` improved to use positions table + real categorization.

**Phase 2 – Reconciliation**
- Kalshi: Full `getOrder`/`getOrders`/`getFills` + active polling. `recordRealFill` now defensively ensures market records.
- Polymarket: Basic open-order reconciliation added.
- `recordRealFill` meaningfully exercised on both platforms.

**Phase 3 – Testing**
- Direct tests added for maxDrawdown and durability paths.
- Total tests: 22 (with better coverage of high-stakes mechanisms).

**Phase 4 – Observability**
- `/api/health` now includes last risk snapshot, kill switch state, and execution health.
- Basic critical alert helper introduced.

**Prior Foundational Work**
- Durable `system_state` + rich risk snapshots.
- Runner startup recovery + behavioral reaction to bad prior state.
- Significant improvements to position tracking and audit events.

---

## Recommended Next Priorities

### Short Term (Next 4–6 weeks)
1. **Reconciliation Hardening** — Improve partial fill handling and fee accuracy (Kalshi first).
2. **Polymarket Parity** — Bring Polymarket reconciliation closer to Kalshi quality.
3. **High-Stakes Test Expansion** — Add guarded tests for reconciliation + kill-switch + risk snapshot recovery under failure conditions.
4. **Alerting** — Wire basic Telegram (or better) alerts for kill switch, high drawdown, and stuck real trades.

### Medium Term
- Deeper position accuracy (live marks from exchanges).
- Stronger maxDrawdown history and volatility-aware limits.
- Deployment improvements (graceful shutdown, state flushing, canary strategy).

---

## Verification & Testing Status

- **Unit Tests**: 22 passing
- **Type Safety**: Clean on core paths
- **Build**: Clean
- **Smoke Test**: Passing
- **CI**: Strict lint + full pipeline
- **Real Execution Paths**: Still require more integration and failure-mode testing

---

## Final Recommendation

Sniper has crossed an important threshold: **it can now remember when it was getting hurt**.

This is a necessary (but not sufficient) condition for responsible real capital operation.

**Current safe operating envelope:**
- Paper trading: Full speed
- Real capital: Very small size + active human oversight + daily review of durable snapshots and reconciliation results

The system is moving in the right direction. Continued disciplined focus on reconciliation completeness, position accuracy, and high-stakes testing will determine how quickly it can graduate to larger real capital responsibility.

---

**Maintainers**: This document should be updated after every significant durability, risk, or reconciliation change. It should always be more conservative than marketing or feature documentation.