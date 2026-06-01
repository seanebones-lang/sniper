# Data Model — Sniper MVP

See `lib/db/schema.ts` for the authoritative Drizzle source of truth.

## Core Entities

- **markets**: Canonical cache of discovered markets from both platforms. Unique on (platform, external_id).
- **strategies**: User-configured automated rules. `config` is flexible JSON for now (MVP). `paper_only` flag is respected by executor.
- **signals**: Immutable record of every "buy/sell here" decision from the strategy engine.
- **paper_trades** / **real_trades**: Execution records. Separate tables for safety and easy analysis.
- **positions**: Current aggregated exposure (updated on fills + mark-to-market).
- **audit_events**: Everything important that happened (signal gen, risk rejection, kill switch, config change, etc.).

## Future (post-MVP)

- performance_snapshots (periodic rollups for charts)
- strategy_runs (session tracking)
- external_market_links (for cross-arb manual/ heuristic pairs)

## Zod Contracts (to be added in lib/types or contracts/)

All API boundaries and strategy outputs should be validated with Zod. Export key schemas to `specs/001-sniper-mvp/contracts/` as JSON for docs if useful.
