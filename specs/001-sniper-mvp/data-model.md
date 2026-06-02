# Data Model — Sniper MVP

**Authoritative source:** `lib/db/schema.ts` (Drizzle ORM).

**Updated:** June 2026.

## Core Entities

| Table | Purpose |
|-------|---------|
| `markets` | Canonical market cache. Unique on `(platform, external_id)`. |
| `strategies` | User-configured rules. `config` JSON + `paper_only` flag. |
| `signals` | Immutable strategy decisions (BUY/SELL/CANCEL). |
| `paper_trades` | Simulated fills — separate from real for safety. |
| `real_trades` | Live execution records (pending/filled/rejected/cancelled). |
| `positions` | Aggregated exposure *(schema exists; not fully wired)*. |
| `audit_events` | Signals, risk rejections, Grok actions, runner events. |
| `market_snapshots` | High-res order book snapshots for research/replay. |

## Important IDs

- **Polymarket `external_id`:** Must be the **CLOB token ID**, not the Gamma numeric market id. Order books fail with wrong id.
- **`signals.market_id`:** References `markets.id` (UUID). **Known gap:** runner may pass API catalog id instead of DB UUID — see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Snapshot Features (`market_snapshots`)

Collected by runner each cycle when book data exists:

- mid, spread, best bid/ask, depth aggregates
- imbalance, micro-price, pressure
- `top_levels` JSON (bids/asks for replay)
- optional regime/volatility in `top_levels.extra`

Used by:

- `replayStrategyOnHistory()` in `lib/data/historical.ts`
- Grok research agent context
- Future ML / feature engineering

## API Validation

Key routes use **Zod** schemas:

- `POST /api/paper/fill`
- `POST /api/settings`

Other routes accept JSON with runtime checks — add Zod as you extend APIs.

## Future (Post-MVP)

- `performance_snapshots` — periodic rollups for charts
- `strategy_runs` — session tracking
- `strategy_variants` — persist variants (currently in-memory)
- `external_market_links` — cross-venue arb pairs
- Formal migration files (today: `drizzle-kit push` primary)

See [docs/STATUS.md](../../docs/STATUS.md) for the full backlog.
