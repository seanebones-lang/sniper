# Architecture

Sniper is a **research + execution platform** first, trading bot second.

See [Project Status](Project-Status) for verified capabilities and blockers.

---

## High-level layers

```
┌─────────────────────────────────────────────────────────┐
│  UI (Next.js App Router)                                │
│  dashboard · markets · strategies · backtest · health   │
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
| Kalshi REST | `lib/clients/kalshi.ts` | Public trade API |
| Market cache | `lib/markets.ts` | ~25s TTL; **not** synced to `markets` DB table |
| Polymarket WS | `lib/ws/polymarket.ts` | Market detail page only |
| Kalshi WS | `lib/ws/kalshi.ts` | Client exists; unused in UI/runner |
| Snapshots | `lib/data/historical.ts` | Written by runner when books available |

---

## 2. Strategy layer

| Component | Location | Notes |
|-----------|----------|-------|
| Four strategies | `lib/strategies/*.ts` | Pluggable `evaluate()` |
| Registry | `lib/strategies/index.ts` | Strategy lookup |
| Allocator | `lib/strategies/allocator.ts` | Signal/fill counts, not PnL |
| Variants | `lib/strategies/variants.ts` | **In-memory** — lost on restart |

---

## 3. Runner

**File:** `lib/runner/engine.ts`

- ~12 second interval via `/api/runner`
- Fetches REST order books for top markets
- Saves `market_snapshots`
- Evaluates active strategies per market
- Applies risk mode filtering and health throttle
- Periodic Grok calls when research agent enabled

**Known issue:** Automated signal insert → fill path broken until markets DB sync (see [Known Issues](Known-Issues-and-Roadmap)).

---

## 4. Risk layer

| Component | Location | Notes |
|-----------|----------|-------|
| Portfolio sizing | `lib/risk/portfolio-manager.ts` | Kelly; placeholder portfolio state |
| Risk modes | `lib/risk/risk-mode-manager.ts` | NORMAL / DEFENSIVE / EMERGENCY |
| Edge decay | `lib/monitoring/edge-decay.ts` | Not fed data |
| Temp adjustments | `lib/monitoring/temporary-adjustments.ts` | Expiration broken |
| AI recommendations | `lib/monitoring/ai-recommendations.ts` | Parses Grok text |

See [Risk Management](Risk-Management) for behavior details.

---

## 5. Execution layer

| Component | Location | Notes |
|-----------|----------|-------|
| ExecutionManager | `lib/execution/execution-manager.ts` | Passive/aggressive decisions |
| PaperSimulator | `lib/execution/paper-simulator.ts` | Manual + managed fills |
| RealExecutor | `lib/execution/real-executor.ts` | Polymarket only; gated |
| SmartRouter | `lib/execution/smart-router.ts` | Book-based routing |

See [Execution Layer](Execution-Layer).

---

## 6. Research layer

| Component | Location | Notes |
|-----------|----------|-------|
| Historical replay | `lib/data/historical.ts` | Snapshot replay |
| Features | `lib/data/features.ts` | Regime detection inputs |
| Grok agent | `lib/research/grok-agent.ts` | Text works; proposals[] empty |
| Performance | `lib/research/performance.ts` | Placeholder attribution |

See [Research & Backtesting](Research-and-Backtesting).

---

## Application structure

```
app/
├── page.tsx              Landing
├── dashboard/            Stats + navigation hub
├── markets/              Discovery + detail (Polymarket WS on detail)
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
2. **Auditable.** Signals and audit events capture reasons (when FK path works).
3. **Self-protecting.** Risk modes and health throttle while process is running.
4. **Honest scope.** Document what works vs what is stubbed.

---

## Key files

| File | Role |
|------|------|
| `lib/runner/engine.ts` | 24/7 loop |
| `lib/execution/execution-manager.ts` | Execution decisions |
| `lib/execution/paper-simulator.ts` | Paper fills |
| `lib/execution/real-executor.ts` | Real orders (Polymarket) |
| `lib/risk/portfolio-manager.ts` | Sizing (approximate state) |
| `lib/clients/polymarket.ts` | Gamma + CLOB |
| `lib/data/historical.ts` | Snapshots + replay |
| `lib/db/schema.ts` | Schema source of truth |

---

## Testing

| Layer | Tool |
|-------|------|
| Lint | ESLint (CI) |
| Unit | Vitest — 8 tests, 2 files |
| Smoke | `scripts/smoke-test.mjs` — not in CI |
| E2E | Playwright — 14 tests (CI) |

---

## Related pages

- [Strategies](Strategies)
- [Operations](Operations)
- [API Reference](API-Reference)
