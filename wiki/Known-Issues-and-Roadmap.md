# Known Issues & Roadmap

**Last verified:** June 2026.

These are **confirmed in code**, not speculative. They block calling the runner "production-ready" for automated trading.

Full capability matrix: [Project Status](Project-Status).

---

## Critical blockers (P0)

### 1. `signals.market_id` foreign key mismatch

| | |
|---|---|
| **Schema** | `signals.market_id` references `markets.id` (UUID) |
| **Runner** | Inserts `marketId: market.id` where `market.id` is the **Gamma market id or Kalshi ticker**, not a DB UUID |
| **Markets table** | No code path inserts discovered markets into `markets` |
| **Effect** | Signal insert likely **fails PostgreSQL FK check**; automated fill path skipped |

**Workaround today:** Manual paper fills via market detail UI or `POST /api/paper/fill`.

**Fix direction:** Sync discovered markets to `markets` table; insert DB UUID into signals.

---

## High priority bugs (P1)

| Issue | Location | Fix direction |
|-------|----------|---------------|
| `incrementRunCount()` never called | `lib/monitoring/temporary-adjustments.ts` | Call at start of each runner cycle |
| `realisticPassiveFills` ignored | `lib/data/historical.ts` | Implement in `replayStrategyOnHistory()` |
| `edgeDecayMonitor.recordWindow()` never called | `lib/monitoring/edge-decay.ts` | Feed performance windows from runner |

---

## Medium priority gaps (P2)

| Issue | Location | Fix direction |
|-------|----------|---------------|
| Variants in-memory only | `lib/strategies/variants.ts` | Persist to DB |
| Grok `proposals[]` always empty | `lib/research/grok-agent.ts` | Parse model output or tool calls |
| `/real` page placeholder | `app/real/page.tsx` | Read server execution flag from API |
| Performance attribution placeholder | `lib/research/performance.ts` | Proper joins signals ↔ paper_trades |
| `positions` table not wired | `lib/db/schema.ts` | Update on fills |

---

## In-memory state (lost on restart)

These module singletons are not persisted:

- Runner status
- Strategy variants
- AI recommendations queue
- Execution manager health
- Risk mode
- Temporary adjustments

---

## MVP phases (accurate)

| Phase | Scope | Status |
|-------|--------|--------|
| **0** | Scaffold, DB schema, Railway config | **Complete** |
| **1** | REST market clients + discovery UI | **Complete** |
| **2** | Paper simulator, manual fill API, Polymarket WS | **Complete** (Kalshi WS: client only) |
| **3** | Strategy engine, runner loop, strategies UI | **Mostly complete** — automated fill pipeline blocked by FK (#1) |
| **4** | Guarded real execution + risk stack | **Partial** — Polymarket coded + gated; Kalshi N/A; DB portfolio incomplete |
| **5** | Backtest, Grok, docs, tests | **Partial** — variant persistence, proposal parsing, replay realism remain |

---

## Suggested first contributions

Good **first PR** targets (self-contained, high value):

1. **Sync discovered markets to `markets` table** — fix signal FK issue (P0)
2. **Call `incrementRunCount()` in runner** — fix adjustment expiration (P1)
3. **Implement realistic passive fills in replay** (P1)
4. **Persist strategy variants to DB** (P2)
5. **Add unit tests for a strategy** — e.g. spread-scalper with mock order book
6. **Export audit log API** — `GET /api/audit?limit=100`
7. **Fix `/real` page** — show actual server execution flag
8. **Parse Grok output into `StrategyProposal[]`**

See [Contributing](Contributing) for full guidelines.

---

## Related pages

- [Project Status](Project-Status)
- [Contributing](Contributing)
- [Architecture](Architecture)
