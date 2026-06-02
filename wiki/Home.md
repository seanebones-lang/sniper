# Sniper Wiki

**A research-first automated trading platform for Polymarket and Kalshi.**

Designed for small, consistent edges over long periods — not gambling or home runs.

> **High risk personal tool.** Most automated prediction market strategies lose money after fees, slippage, and adverse selection. You can lose all capital. **Paper mode is strongly recommended** for extended periods before any real money.

---

## What Sniper is

- Market discovery and order book research UI (Polymarket + Kalshi REST + WS on detail pages)
- Paper-trading simulator with manual and **automated** fill paths → ledger + mark-to-market P&L
- 24/7 runner with deduplicated book cache, 4–12s adaptive interval, and five strategy types
- Backtesting lab with synthetic and historical replay
- Grok (xAI) research layer — analysis, structured proposals, RECOMMENDED ACTIONS auto-apply
- Optional, heavily gated real execution on **Polymarket and Kalshi**

## What Sniper is not (today)

- A production-ready unattended real-money bot — see [Known Issues](Known-Issues-and-Roadmap)
- A cross-venue arbitrage engine
- CI-validated live trading (real paths are coded but gated and untested with live keys)

**Authoritative status:** [Project Status](Project-Status) — capability matrix verified against code (June 2, 2026).

---

## Core philosophy

| Principle | Meaning |
|-----------|---------|
| **Paper mode is sacred** | Default and primary way to operate |
| **Self-protection first** | System throttles when hurt (edge decay, risk modes, health throttle) |
| **Research flywheel** | Snapshots → analysis → replay → validate |
| **Execution quality** | Adverse selection and poor fills destroy edges |
| **Auditable everything** | Signals and audit events capture reasons |

---

## Quick links

| I want to… | Start here |
|------------|------------|
| Run locally | [Getting Started](Getting-Started) |
| Understand what works | [Project Status](Project-Status) |
| Configure strategies | [Strategies](Strategies) |
| Use the UI | [UI Guide](UI-Guide) |
| Backtest / Grok research | [Research & Backtesting](Research-and-Backtesting) |
| Deploy 24/7 | [Operations](Operations) |
| Call APIs | [API Reference](API-Reference) |
| Fix bugs / contribute | [Contributing](Contributing) |
| See screenshots | [Screenshots](Screenshots) |

---

## MVP phases (accurate)

| Phase | Scope | Status |
|-------|--------|--------|
| **0** | Scaffold, DB schema, Railway | Complete |
| **1** | REST clients + discovery UI | Complete |
| **2** | Paper simulator, manual fill API, Polymarket WS | Complete |
| **3** | Strategy engine, runner, strategies UI | **Complete** — automated fills + quick-flip + Kalshi |
| **4** | Real execution + risk stack | Partial — Polymarket + Kalshi coded + gated |
| **5** | Backtest, Grok, docs, tests | Partial — replay realism, variant persistence, runner tests |

---

## Tech stack

- Next.js 16 (App Router), TypeScript strict, ESLint
- Drizzle ORM + PostgreSQL
- Polymarket: `@polymarket/clob-client-v2`, Gamma API, viem
- Kalshi: REST + WS on market detail page
- Vitest (**57 unit tests**), Playwright (e2e), smoke script
- xAI Grok via Vercel AI SDK (optional)

**Repo:** [github.com/seanebones-lang/sniper](https://github.com/seanebones-lang/sniper)

**License:** MIT (personal use encouraged; commercial redistribution of trading logic requires care).
