# Sniper — Production Readiness Review

**Date:** June 2, 2026  
**Status:** Experimental / Hardening for Real Capital

Companion to [docs/STATUS.md](STATUS.md).

---

## Executive Summary

**Overall Assessment: Not yet ready for unsupervised real capital deployment.**

**Paper trading: Production-ready.** Ledger + MTM P&L, automated fills, risk-unified sizing, and dashboard observability are verified (57 unit tests, e2e in CI).

**Real capital with heavy human oversight + very small size:** Feasible — durable kill switch, risk snapshots, and gated execution paths exist. Not CI-tested with live keys.

**Unsupervised or meaningful real capital:** Not recommended yet.

---

## Major Strengths

| Area | Assessment |
|------|------------|
| **Paper accounting** | Strong — cash ledger + MTM; unified with risk manager |
| **State durability** | Strong — `system_state`, kill switch, risk snapshots |
| **Self-protection** | Strong — risk modes, edge decay, health throttle, exit bypass |
| **Runner reliability** | Improved — book cache, overlap guard, adaptive interval |
| **Auditability** | Strong — `audit_events` + health API recent audits |
| **ID discipline** | Strong — `ensureMarketRecord` enforced |

---

## Remaining Gaps

### Critical (blocks unsupervised real capital)

1. **Reconciliation completeness** — partial fills, fee accuracy, Polymarket fill confirmation
2. **Real execution CI** — no automated tests with live or sandbox keys
3. **High-stakes failure injection** — kill switch, maxDrawdown, reconciliation under fault

### High

4. **Variant persistence** — in-memory only
5. **Replay passive fill realism** — UI flag not implemented
6. **Runner integration tests** — no CI coverage for full cycle

### Medium

7. **Daily P&L baseline** — start-of-day uses cost basis, not MTM
8. **In-memory partial state** — execution manager history, edge decay windows on restart
9. **`/real` page** — placeholder server status

---

## Paper Mode Verdict

**Ready for extended 24/7 paper operation** with monitoring via `/dashboard`, `/health`, and `scripts/diagnose-paper-pnl.ts`.

See [OPERATIONS.md](OPERATIONS.md) for run checklists.
