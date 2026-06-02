# Project Status

**Last verified:** June 2026 (against codebase at `main`).

This page is the **authoritative capability matrix** for reviewers. If README or other docs disagree with this page, **this page wins** until updated.

The same content lives in the repo at `docs/STATUS.md`.

---

## Summary

Sniper is a **research and paper-trading platform** with optional, gated real execution on Polymarket. It is **not** production-ready as a fully autonomous 24/7 trading system until the blockers in [Known Issues](Known-Issues-and-Roadmap) are resolved.

What reviewers can evaluate today with confidence:

- Market discovery and order book UI (Polymarket + Kalshi REST)
- Manual paper fills (UI + API → `paper_trades`)
- Strategy evaluation logic (four strategy types)
- Runner loop (REST books, snapshot collection, risk-mode behavior)
- Historical replay (when snapshots exist)
- Grok analysis (with xAI key; text output + RECOMMENDED ACTIONS parsing)
- CI: ESLint, build, unit tests, Playwright e2e

---

## Capability matrix

| Capability | Status | Notes |
|------------|--------|-------|
| Polymarket discovery + order books (REST) | **Works** | Gamma + CLOB; `externalId` must be CLOB token ID |
| Kalshi discovery + order books (REST) | **Works** | Public REST |
| Markets UI + last prices | **Works** | Depends on live external APIs |
| Manual paper fill (`POST /api/paper/fill`, market UI) | **Works** | Persists to `paper_trades`; no `signals` FK |
| Runner loop (evaluate, snapshots, risk modes) | **Works** | 12s interval via `/api/runner`; in-memory state |
| Runner automated signal → DB → paper fill | **Broken** | See [Known Issues](Known-Issues-and-Roadmap) |
| Four strategy types (`evaluate()`) | **Works** | spread-scalper, threshold, orderbook-imbalance, resolution-proximity |
| Strategy CRUD + runner start/stop UI | **Works** | Default `paperOnly: true` |
| `market_snapshots` collection | **Works** | When runner active and book data present |
| Historical replay | **Works** | Requires prior runner soak; 0 snapshots = empty result |
| Replay “realistic passive fills” toggle | **Not implemented** | API/UI pass flag; replay engine ignores it |
| Synthetic backtest (price series) | **Works** | In-process; no DB |
| Risk modes (NORMAL / DEFENSIVE / EMERGENCY) | **Works in-process** | Resets on restart; not persisted |
| Portfolio / Kelly sizing | **Partial** | Runs but uses placeholder portfolio state |
| Edge decay → risk mode | **Not wired** | `recordWindow()` never called |
| Grok market intel (`/api/grok/intel`) | **Works** | Requires xAI key |
| Grok research agent (`/api/research/agent`) | **Works** | Text analysis; structured `proposals[]` always empty |
| RECOMMENDED ACTIONS parse + auto-apply | **Partial** | Text parsing works; adjustment expiration broken |
| Temporary Grok adjustments expiration | **Broken** | `incrementRunCount()` never called |
| Strategy variants | **Partial** | In-memory only; lost on restart |
| Performance attribution API | **Partial** | Placeholder logic |
| Polymarket live WebSocket (market detail) | **Works** | Detail page only |
| Kalshi WebSocket client | **Library only** | Not used in UI or runner |
| Real Polymarket limit orders | **Coded, gated** | Not CI-tested |
| Real Kalshi execution | **Not implemented** | Explicit error in executor |
| Cross-venue arbitrage | **Not implemented** | — |
| `positions` DB table | **Not wired** | Schema only |
| `markets` DB table sync | **Not implemented** | Discovery is in-memory cache only |
| `/real` status page | **Placeholder** | Does not read server execution flag |
| CI (lint, build, unit, e2e) | **Works** | Smoke tests not in CI |

---

## Test coverage

| Layer | Count | Scope |
|-------|-------|-------|
| Unit (Vitest) | 8 tests / 2 files | `orderbook`, `paper-simulator` |
| Smoke | 14 checks | `scripts/smoke-test.mjs` (not in CI) |
| E2E (Playwright) | 14 tests / 5 specs | Navigation, markets, strategies, backtest, paper fill |
| CI | lint + build + unit + e2e | `.github/workflows/ci.yml` |

No automated tests cover: runner loop, strategies `evaluate()`, risk modes, real execution, Grok agent.

---

## Related pages

- [Known Issues & Roadmap](Known-Issues-and-Roadmap) — critical blockers with fix directions
- [Architecture](Architecture) — system design
- [Contributing](Contributing) — how to help fix gaps
