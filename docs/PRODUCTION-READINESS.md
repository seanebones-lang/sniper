# Sniper — Production Readiness Review

**Date:** June 3, 2026  
**Status:** Tiny-live capable with human oversight

Companion to [docs/STATUS.md](STATUS.md).

---

## Executive Summary

**Overall Assessment:** Suitable for **tiny live capital ($4–$50)** with continuous monitoring. Not yet ready for unsupervised or meaningful capital.

**Paper trading: Production-ready.** Ledger + MTM P&L, automated fills, risk-unified sizing, and dashboard observability are verified (110+ unit tests, e2e in CI).

**Real capital with heavy human oversight + very small size:** Operational — reconciliation hardening, live ops UI, readiness probe, API auth, Grok live guard, and max-3 position cap shipped June 3, 2026.

**Unsupervised or meaningful real capital:** Not recommended until 48h+ soak with zero manual DB edits.

---

## Major Strengths

| Area | Assessment |
|------|------------|
| **Paper accounting** | Strong — cash ledger + MTM; unified with risk manager |
| **Live ops observability** | Improved — `/real` ops panel, `/api/real/ops`, readiness endpoint |
| **Reconciliation** | Improved — token-balance fallback, immediate fill hook, idempotent fills |
| **State durability** | Strong — `system_state`, kill switch, risk snapshots, variant persistence |
| **Self-protection** | Strong — risk modes, Grok auto-apply disabled when live, max 3 positions |
| **Security** | Improved — optional `SNIPER_API_SECRET` on mutating routes |
| **Auditability** | Strong — `audit_events` + health API recent audits |

---

## Remaining Gaps

### Critical (blocks unsupervised real capital)

1. **Live soak evidence** — code is ready; need 48h+ with zero manual DB surgery
2. **Real execution CI with live keys** — mocked unit tests only
3. **Failure injection under load** — kill switch, lock loss, geoblock, DB down

### Medium

4. **Daily P&L baseline** — start-of-day uses cost basis, not MTM
5. **In-memory partial state** — execution manager history, edge decay windows on restart

---

## Paper Mode Verdict

**Ready for extended 24/7 paper operation** with monitoring via `/dashboard`, `/health`, and `scripts/diagnose-paper-pnl.ts`.

## Live Mode Verdict

**Ready for tiny-live soak** when:

- `SNIPER_ENABLE_REAL_EXECUTION=true`
- `SNIPER_API_SECRET` set on public deployments
- `TELEGRAM_*` configured for alerts
- Soak gate in [runbooks/real-execution.md](runbooks/real-execution.md) completed

See `/real` for live ops and `/api/health/ready` for deploy readiness.
