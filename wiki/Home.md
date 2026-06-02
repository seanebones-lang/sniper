# Sniper Wiki

**A research-first automated trading platform for Polymarket and Kalshi.**

Designed for small, consistent edges over long periods — not gambling or home runs.

> **High risk personal tool.** Most automated prediction market strategies lose money after fees, slippage, and adverse selection. You can lose all capital. **Paper mode is strongly recommended** for extended periods before any real money.

---

## What Sniper is

- Market discovery and order book research UI (Polymarket + Kalshi)
- Paper-trading simulator with manual and (intended) automated fill paths
- 24/7 runner that collects order book snapshots and evaluates strategies
- Backtesting lab with synthetic and historical replay
- Optional Grok (xAI) research layer for analysis and recommendations
- Optional, heavily gated real execution path for **Polymarket only**

## What Sniper is not (today)

- A production-ready unattended trading bot — see [Known Issues](Known-Issues-and-Roadmap)
- A Kalshi real-money execution system
- A cross-venue arbitrage engine

**Authoritative status:** [Project Status](Project-Status) — capability matrix verified against code.

---

## Core philosophy

| Principle | Meaning |
|-----------|---------|
| **Paper mode is sacred** | Default and primary way to operate |
| **Self-protection first** | System throttles when hurt (while runner is up) |
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
| **3** | Strategy engine, runner, strategies UI | Mostly complete — [FK blocker](Known-Issues-and-Roadmap) |
| **4** | Real execution + risk stack | Partial — Polymarket gated; Kalshi N/A |
| **5** | Backtest, Grok, docs, tests | Partial — see [Project Status](Project-Status) |

---

## Tech stack

- Next.js 16 (App Router), TypeScript strict, ESLint
- Drizzle ORM + PostgreSQL
- Polymarket: `@polymarket/clob-client-v2`, Gamma API, viem
- Kalshi: REST (+ WS client library, not wired in UI)
- Vitest (unit), Playwright (e2e), smoke script
- xAI Grok via Vercel AI SDK (optional)

**Repo:** [github.com/seanebones-lang/sniper](https://github.com/seanebones-lang/sniper)

**License:** MIT (personal use encouraged; commercial redistribution of trading logic requires care).
