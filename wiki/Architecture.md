# Architecture

Sniper is a **research + execution platform** first, trading bot second.

See [Project Status](Project-Status) for verified capabilities and blockers (June 2, 2026).

---

## High-level layers

```
┌─────────────────────────────────────────────────────────┐
│  UI (Next.js App Router)                                │
│  dashboard · markets · paper · strategies · backtest    │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  API Routes (/app/api/*)                                │
└──────────────────────────┬──────────────────────────────┘
                           │
     ┌─────────────────────┼─────────────────────┐
     │                     │                     │
┌────▼────┐  ┌─────────────▼──────────┐  ┌───────▼───────┐
│  Data   │  │  Strategy + Runner     │  │  Research     │
│  Layer  │  │  Layer                 │  │  Layer        │
└────┬────┘  └─────────────┬──────────┘  └───────┬───────┘
     │                     │                     │
     └─────────────────────┼─────────────────────┘
                           │
     ┌─────────────────────┼─────────────────────┐
     │                     │                     │
┌────▼────┐  ┌─────────────▼──────────┐  ┌───────▼───────┐
│  Risk   │  │  Execution             │  │  PostgreSQL   │
│  Layer  │  │  Layer                 │  │  (Drizzle)    │
└─────────┘  └────────────────────────┘  └───────────────┘
```

---

## 1. Data layer

| Component | Location | Notes |
|-----------|----------|-------|
| Polymarket REST | `lib/clients/polymarket.ts` | Gamma API + CLOB |
| Kalshi REST | `lib/clients/kalshi.ts` | Public trade API; `orderbook_fp` parser |
| Market records | `lib/markets.ts` / `ensureMarketRecord` | Syncs to `markets` DB table before signals |
| Polymarket WS | `lib/ws/polymarket.ts` | Market detail page only |
| Kalshi WS | `lib/ws/kalshi.ts` | `KalshiWSClient` on `/markets/kalshi/[id]` |
| Snapshots | `lib/data/historical.ts` | Written by runner; throttled 1-in-3 saves |
| Book cache | `lib/runner/book-cache.ts` | Deduplicated REST book fetches in runner |

---

## 2. Strategy layer

| Component | Location | Notes |
|-----------|----------|-------|
| Five strategies | `lib/strategies/*.ts` | Pluggable `evaluate()` — includes live-quick-flip |
| Registry | `lib/strategies/index.ts` | Strategy lookup |
| Allocator | `lib/strategies/allocator.ts` | Weights by recent PnL + activity |
| Variants | `lib/strategies/variants.ts` | **In-memory** — lost on restart |

---

## 3. Runner

**File:** `lib/runner/engine.ts`

- **4–12s adaptive interval** via `/api/runner`; overlap guard; cycle timing in `/api/health`
- Deduplicated REST order books via `book-cache.ts`
- Saves `market_snapshots` (throttled)
- Evaluates active strategies per market; regime from snapshots
- `ensureMarketRecord()` before signal insert → automated paper fill path
- `loadPaperRiskState` → `setCyclePortfolioState` each cycle
- `incrementRunCount()` at start of each `runOnce()` for Grok adjustment expiration
- `recordWindow()` fed from per-strategy paper PnL for edge decay
- Periodic Grok calls when research agent enabled

**Limitation:** Runner uses REST books only (WS on detail page, not in runner loop).

---

## 4. Risk layer

| Component | Location | Notes |
|-----------|----------|-------|
| Portfolio sizing | `lib/risk/portfolio-manager.ts` | Kelly; fed from paper ledger state each cycle |
| Paper risk state | `lib/paper/risk-state.ts` | `loadPaperRiskState` hydrates portfolio for sizing |
| Share sizing | `lib/risk/sizing.ts` | `computeFinalShareSize` — USD → shares |
| Risk modes | `lib/risk/risk-mode-manager.ts` | NORMAL / DEFENSIVE / EMERGENCY; durable on transition |
| Edge decay | `lib/monitoring/edge-decay.ts` | Fed from per-strategy paper PnL each cycle |
| Temp adjustments | `lib/monitoring/temporary-adjustments.ts` | Expiration via `incrementRunCount()` |
| AI recommendations | `lib/monitoring/ai-recommendations.ts` | Parses Grok text; auto-apply RECOMMENDED ACTIONS |

See [Risk Management](Risk-Management) for behavior details.

---

## 5. Execution layer

| Component | Location | Notes |
|-----------|----------|-------|
| ExecutionManager | `lib/execution/execution-manager.ts` | Passive/aggressive decisions |
| PaperSimulator | `lib/execution/paper-simulator.ts` | Manual + automated fills |
| Paper ledger / MTM | `lib/paper/portfolio.ts`, `mark-to-market.ts` | P&L for dashboard + risk |
| RealExecutor | `lib/execution/real-executor.ts` | Polymarket + Kalshi; gated |
| SmartRouter | `lib/execution/smart-router.ts` | Book-based routing |

See [Execution Layer](Execution-Layer).

---

## 6. Research layer

| Component | Location | Notes |
|-----------|----------|-------|
| Historical replay | `lib/data/historical.ts` | Snapshot replay; passive fills not implemented |
| Features | `lib/data/features.ts` | Regime detection inputs |
| Grok agent | `lib/research/grok-agent.ts` | Text + JSON/`PROPOSALS` proposal parsing |
| Performance | `lib/research/performance.ts` | Per-strategy attribution via `paper_trades` joins |
| Strategy PnL | `lib/paper/strategy-pnl.ts` | Per-strategy paper PnL for edge decay |

See [Research & Backtesting](Research-and-Backtesting).

---

## Application structure

```
app/
├── page.tsx              Landing
├── dashboard/            Stats + paper P&L hub
├── paper/                Paper portfolio + P&L breakdown
├── markets/              Discovery + detail (Polymarket/Kalshi WS on detail)
├── strategies/           CRUD + runner control
├── backtest/             Synthetic + historical replay + Grok lab
├── settings/             Grok key (file or env)
├── health/               Risk + execution dashboard
├── real/                 Real-money warnings (placeholder status)
└── api/                  REST endpoints — see API Reference
```

---

## Design principles

1. **Paper first, always.** Real money requires env flag + non-paper strategy + risk gates.
2. **Auditable.** Signals and audit events capture reasons.
3. **Self-protecting.** Risk modes, edge decay, and health throttle while process is running.
4. **Honest scope.** Document what works vs what is stubbed.

---

## Key files

| File | Role |
|------|------|
| `lib/runner/engine.ts` | 24/7 loop |
| `lib/runner/book-cache.ts` | Deduplicated book fetches |
| `lib/execution/execution-manager.ts` | Execution decisions |
| `lib/execution/paper-simulator.ts` | Paper fills |
| `lib/execution/real-executor.ts` | Real orders (Polymarket + Kalshi) |
| `lib/risk/portfolio-manager.ts` | Sizing from paper ledger |
| `lib/paper/risk-state.ts` | Paper portfolio state for risk |
| `lib/clients/polymarket.ts` | Gamma + CLOB |
| `lib/data/historical.ts` | Snapshots + replay |
| `lib/db/schema.ts` | Schema source of truth |

---

## Testing

| Layer | Tool |
|-------|------|
| Lint | ESLint (CI) |
| Unit | Vitest — **57 tests**, 15 files |
| Smoke | `scripts/smoke-test.mjs` — not in CI |
| E2E | Playwright — 14 tests (CI) |

No automated tests cover: full runner loop, strategies `evaluate()` under load, real execution, Grok agent live calls.

---

## Related pages

- [Strategies](Strategies)
- [Operations](Operations)
- [API Reference](API-Reference)
