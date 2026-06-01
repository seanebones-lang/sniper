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

**Core System**
- Multi-venue data (Polymarket CLOB + Kalshi) with real-time WebSockets
- Central `ExecutionManager` with passive/adversarial decisioning, order lifecycle, and per-market health tracking
- Realistic passive fill simulation in paper + replay modes

**Risk & Autonomy**
- Professional multi-layer risk (PortfolioRiskManager + Kelly + category limits)
- Dynamic Strategy Allocator
- Explicit **Risk Modes** (NORMAL / DEFENSIVE / EMERGENCY) that automatically change system behavior:
  - Fewer markets evaluated
  - Weaker strategies deprioritized or paused
  - Aggressive global risk reduction
- Real self-protection: runner actively throttles unhealthy markets and follows ExecutionManager recommendations

**Research & Intelligence Flywheel**
- Rich historical snapshot collection with advanced features (imbalance, regime, volatility, etc.)
- Powerful replay engine with realistic passive fill simulation
- Grok Research Agent that produces **structured, actionable recommendations**
- Recommendations can be manually applied or **auto-applied** as temporary adjustments (with automatic expiration)
- Full tracking of recommendation outcomes
- Variants system for safe testing of agent-proposed changes

**Observability**
- Excellent `/health` dashboard (risk mode + active restrictions + execution health + AI recommendations)
- Edge decay monitoring
- Performance attribution
- Telegram alerts for important events

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

- <img width="1440" height="900" alt="Screenshot 2026-05-31 at 10 53 43 PM" src="https://github.com/user-attachments/assets/9a04c4fa-2457-405a-81bf-04d72f7a24a1" />


## License

MIT (personal use strongly encouraged; commercial redistribution of the trading logic requires care).

---

Built for serious personal experimentation with prediction market automation. No hype.
