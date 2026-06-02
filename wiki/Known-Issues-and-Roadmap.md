# Known Issues & Roadmap

**Last verified:** June 2, 2026.

These are **confirmed in code**, not speculative. They block calling the system **fully production-ready** for unsupervised 24/7 real-money trading.

Full capability matrix: [Project Status](Project-Status).

---

## Resolved (June 2026)

| Issue | Resolution |
|-------|------------|
| `signals.market_id` FK mismatch | **Fixed** — `ensureMarketRecord()` called before signal/trade inserts |
| Paper P&L unavailable | **Fixed** — ledger + MTM via `computePaperLedger` / `computeMarkToMarket` |
| Risk sizing placeholder state | **Fixed** — `loadPaperRiskState` → `setCyclePortfolioState` each runner cycle |
| `incrementRunCount()` never called | **Fixed** — called at start of each `runOnce()` |
| Edge decay not wired | **Fixed** — `recordWindow()` fed from per-strategy paper PnL each cycle |
| Grok `proposals[]` always empty | **Fixed** — JSON/`PROPOSALS` parsing in `grok-agent.ts` |
| Performance attribution placeholder | **Fixed** — per-strategy PnL via `paper_trades` → `signals` joins |

---

## Remaining blockers

### P1 — High priority

| Issue | Location | Fix direction |
|-------|----------|---------------|
| `realisticPassiveFills` ignored | `lib/data/historical.ts` | Implement in `replayStrategyOnHistory()` |
| Runner integration tests | — | Add CI coverage for full runner loop and `evaluate()` |
| Runner WS book feed | `lib/runner/engine.ts` | REST books only in runner (WS on detail page) |

### P2 — Medium priority

| Issue | Location | Fix direction |
|-------|----------|---------------|
| Variants in-memory only | `lib/strategies/variants.ts` | Persist to DB |
| `/real` page placeholder | `app/real/page.tsx` | Read server execution flag from API |

---

## In-memory state (partially mitigated)

Durable via `system_state`: kill switch, risk mode, risk snapshots, execution health.

Still lost on restart:

- Runner session counters
- Strategy variants
- Execution manager fill history
- Edge decay windows
- Temporary adjustments (until re-loaded from DB if persisted)

---

## Known accuracy caveats (non-blocking)

| Caveat | Notes |
|--------|-------|
| Daily P&L baseline | Start-of-day equity uses cost basis for open positions; intraday MTM can skew daily loss breaker slightly |
| Long paper runs | Full run-session trades loaded for ledger (no 2000 cap on hydration) |
| Real execution | Kill-switch + gates coded; not CI-tested with live keys |

---

## MVP phases (accurate)

| Phase | Scope | Status |
|-------|--------|--------|
| **0** | Scaffold, DB schema, Railway config | **Complete** |
| **1** | REST market clients + discovery UI | **Complete** |
| **2** | Paper simulator, manual fill API, Polymarket WS on detail | **Complete** |
| **3** | Strategy engine, runner loop, strategies UI | **Complete** — quick-flip + Kalshi in runner pool |
| **4** | Guarded real execution + risk stack | **Partial** — Polymarket + Kalshi coded + gated; real path not CI-tested |
| **5** | Backtest, Grok, docs, tests | **Partial** — replay realism, variant persistence, runner integration tests remain |

---

## Suggested first contributions

Good **first PR** targets (self-contained, high value):

1. **Implement realistic passive fills in replay** (P1)
2. **Persist strategy variants to DB** (P2)
3. **Add runner integration tests** — full loop + `evaluate()` in CI
4. **Add unit tests for a strategy** — e.g. spread-scalper with mock order book
5. **Export audit log API** — `GET /api/audit?limit=100`
6. **Fix `/real` page** — show actual server execution flag
7. **Wire Kalshi WS into runner** — reduce REST polling latency

See [Contributing](Contributing) for full guidelines.

---

## Related pages

- [Project Status](Project-Status)
- [Contributing](Contributing)
- [Architecture](Architecture)
