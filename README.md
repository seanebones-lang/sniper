# Sniper

**Personal 24/7 web app for automated sniping/scalping on Polymarket and Kalshi.**

Paper trading first. Real money execution is opt-in, heavily guarded, and only after you have validated edges in simulation for weeks.

> ⚠️ **This is a high-risk personal tool, not a product that guarantees profits.** Prediction markets are competitive. Most automated strategies lose money after fees, slippage, and adverse selection. You can lose all capital. Use at your own risk.

## Core Principles

- **Paper mode is sacred** — the primary way to run this system.
- Deterministic, fully auditable decisions (every signal explains exactly why).
- Strong risk limits + kill switches at every layer.
- Built with the stack you already trust: Next.js 16 + TypeScript + Drizzle + Railway + Vitest.

## Quickstart (Paper Only — Recommended)

```bash
git clone https://github.com/seanebones-lang/sniper.git
cd sniper
cp .env.example .env.local
npm install
npm run db:push          # requires local Postgres or set DATABASE_URL
npm run dev
```

1. Open http://localhost:3000
2. Create a simple strategy (spread scalper or threshold) on 2–3 liquid short-term markets.
3. Watch the live decision log and paper PnL update.
4. Let it run for hours/days. Export logs.

See `specs/001-sniper-mvp/quickstart.md` and the in-app banners.

## 48-Hour Paper Soak Test (Before Considering Real Money)

- Configure 3–5 high-volume short-duration markets (e.g. BTC/ETH 5m/15m).
- Run continuously (local + Railway deploy).
- Verify: no crashes, correct reconnect behavior, no duplicate signals, sane PnL math, full reasoning in every log entry.
- Kill switch works.
- Export decision log and review every fill.

Only after this (and ideally 1–2 weeks of positive simulated expectancy on your chosen edges) should you even think about tiny real sizes.

## Deployment (Railway — Matches Your Other Projects)

1. Create Railway project from this repo.
2. Add **PostgreSQL** plugin (it injects `DATABASE_URL`).
3. Set any trading secrets as Railway variables (never in code).
4. After first deploy: run `npm run db:push` in the Railway shell.
5. Redeploy. Use always-on / hobby / pro tier for 24/7.

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
