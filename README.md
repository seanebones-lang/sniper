# Sniper

**A research-first, self-protecting 24/7 automated trading system for Polymarket and Kalshi.**

Designed for small, consistent edges over long periods — not gambling or home runs.

> ⚠️ **High risk personal tool.** Most automated prediction market strategies lose money after fees, slippage, and adverse selection. You can lose all capital. Paper mode is strongly recommended for extended periods before any real money.

## Core Philosophy

- **Paper mode is sacred** — the default and primary way to operate.
- **Self-protection first** — the system must detect when it is getting hurt and reduce risk automatically.
- **Research flywheel** — rich data collection + Grok analysis + structured proposals + automated replay validation.
- **Execution quality matters** — signals are only half the game. Adverse selection and poor fills destroy edges.
- **Auditable everything** — every size decision has a traceable reason.

## Current Capabilities (as of latest build)

- Multi-venue data (Polymarket CLOB + Kalshi) with real-time WebSockets
- Professional risk system (fractional Kelly + category limits + concentration + daily breakers)
- Dynamic Strategy Allocator based on recent performance
- Multiple edges including order book imbalance and resolution proximity
- Central `ExecutionManager` with adverse selection detection and per-market health tracking
- Self-protection: runner automatically downweights markets with poor recent execution
- Historical snapshot collection + powerful replay engine
- Grok Research Agent that analyzes your data and proposes testable improvements
- Variants system: turn agent proposals into versioned configurations and compare them
- Strong observability (`/health`, attribution, Telegram alerts)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a deeper breakdown.

## Quickstart (Paper Recommended)

```bash
git clone https://github.com/seanebones-lang/sniper.git
cd sniper
cp .env.example .env.local
npm install
npm run db:push
npm run dev
```

1. Go to `/strategies`
2. Create 1-2 strategies on liquid short-term markets
3. Start the runner
4. Let it run and observe

## Important 48h+ Soak Test

Before even considering tiny real sizes:

- Run on multiple markets for at least 48–72 hours
- Review execution quality (not just P&L)
- Check that unhealthy market detection and health throttling are working
- Export decision logs and review reasons

See the in-app banners and `docs/` folder for more guidance.

## Key Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — overall system design
- [docs/RISK.md](docs/RISK.md) — risk philosophy and layers
- [docs/EXECUTION.md](docs/EXECUTION.md) — execution quality focus
- [docs/RESEARCH.md](docs/RESEARCH.md) — research flywheel and Grok agent

## Deployment

Primary target is Railway (Postgres + always-on).

Critical secrets for real trading:
- `SNIPER_ENABLE_REAL_EXECUTION=true`
- `POLYMARKET_PRIVATE_KEY` (dedicated low-balance wallet strongly recommended)
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (highly recommended for alerts)
- `XAI_API_KEY` (for Grok Research Agent)
- `ENABLE_GROK_RESEARCH_AGENT=true` (optional)

## Warning

This is an advanced personal research and execution platform. It is not magic. Consistent small profits in prediction markets require real edge, excellent risk management, and patience.

Most people who try this lose money.

Use responsibly. Paper mode is your friend.

## Environment Variables

Copy `.env.example` and read the warnings carefully.

Critical ones for real execution (opt-in only):
- `POLYMARKET_PRIVATE_KEY`
- Kalshi RSA key material

These are **never** exposed to the browser.

## Tech Stack

- Next.js 16 (App Router) + TypeScript strict
- Drizzle ORM + PostgreSQL (Railway)
- Official Polymarket `@polymarket/clob-client-v2` + viem
- Kalshi REST + WS (RSA signed)
- Native WebSockets with heartbeats + reconnect
- Vitest + React Testing Library
- Sonner, Lucide, TanStack Query, Zod
- Optional: xAI Grok for research panels (later phases)

## Current Status (MVP Roadmap)

See the detailed plan in the session notes or `specs/001-sniper-mvp/`.

Phases (executed slice-by-slice):
- [x] Phase 0: Scaffold + patterns + disclaimers + DB skeleton + Railway
- [ ] Phase 1: Market data clients + browser UI
- [ ] Phase 2: Real-time WS + paper simulator
- [ ] Phase 3: Strategy engine + 24/7 paper runner + config
- [ ] Phase 4: Guarded real execution + risk engine
- [ ] Phase 5: Polish, backtesting, Grok intel, docs

## Safety & Disclaimers (Repeated for Emphasis)

- This software does **not** provide financial, legal, or investment advice.
- Past simulated performance ≠ future results.
- You are 100% responsible for every trade, every key, and every dollar.
- Start with paper. Stay with paper until you have irrefutable evidence of edge on your specific strategies and risk tolerance.

## License

MIT (personal use strongly encouraged; commercial redistribution of the trading logic requires care).

---

Built for serious personal experimentation with prediction market automation. No hype.
