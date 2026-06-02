# Current Project Status

**Last synced:** June 2, 2026

This page is a mirror of the authoritative status in the main repo.

**Primary source:** [docs/STATUS.md](https://github.com/seanebones-lang/sniper/blob/main/docs/STATUS.md)

## High-Level Readiness

| Area                        | Status          |
|----------------------------|-----------------|
| Paper Trading              | **Reliable** — automated fills, ledger + MTM P&L |
| Risk Management            | **Strong** — paper ledger state, edge decay wired |
| Research / Grok            | **Works** — proposals parsed, RECOMMENDED ACTIONS auto-apply |
| Real Execution (Polymarket)  | **Coded, gated** — not CI-tested |
| Real Execution (Kalshi)    | **Coded, gated** — requires API keys |
| Real Capital (Unsupervised)| **Not Ready** — see [Known Issues](Known-Issues-and-Roadmap) |

## What works today (June 2026)

- Market discovery and order book UI (Polymarket + Kalshi REST + WS on detail pages)
- Manual and **automated paper fills** → `paper_trades` with ledger + mark-to-market P&L
- Five strategy types including live-quick-flip (3h resolution window)
- Runner loop with deduplicated book cache, 4–12s adaptive interval, risk-unified sizing
- Dashboard paper P&L, equity, realized/unrealized breakdown
- Edge decay → risk mode; Grok adjustment expiration via `incrementRunCount()`
- CI: ESLint, build, **57 unit tests**, Playwright e2e

See [Project Status](Project-Status) for the full capability matrix and [Known Issues & Roadmap](Known-Issues-and-Roadmap) for remaining blockers.
