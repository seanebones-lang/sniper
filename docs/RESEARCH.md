# Research & Edge Discovery

**Status:** [STATUS.md](./STATUS.md)

## The Research Flywheel (intended)

```
Runner collects snapshots (works)
        ↓
Performance + execution data (partial — attribution placeholder)
        ↓
Grok Research Agent (works — text output)
        ↓
Structured proposals (NOT implemented — proposals[] always empty)
        ↓
Strategy Variants (in-memory only)
        ↓
Historical replay (works if snapshots exist)
        ↓
Promote / reject (manual)
```

## UI: Research & Backtesting Lab

**Route:** `/backtest`

| Section | Status |
|---------|--------|
| Synthetic price series backtest | Works (in-process) |
| Historical order book replay | Works when snapshots exist |
| Market dropdown | Works (live `/api/markets`) |
| Grok research agent buttons | Works with xAI key |
| Grok proposals list | Empty unless manually seeded via audit events |
| “Realistic passive fills” checkbox | **UI only** — replay engine ignores flag |

## Grok / xAI Setup

- **Settings UI** (`/settings`) → `data/user-settings.json` (gitignored)
- **Env:** `XAI_API_KEY` overrides file; `ENABLE_GROK_RESEARCH_AGENT=true` for runner periodic calls

## Backend Components

| Component | File | Status |
|-----------|------|--------|
| Snapshot storage | `lib/data/historical.ts` | Works |
| Replay | `replayStrategyOnHistory()` | Works; no realistic fill mode |
| Features | `lib/data/features.ts` | Works |
| Grok agent | `lib/research/grok-agent.ts` | Text works; proposals[] empty |
| RECOMMENDED ACTIONS | `lib/monitoring/ai-recommendations.ts` | Parsed from text |
| Variants | `lib/strategies/variants.ts` | In-memory |
| Apply proposal API | `app/api/research/apply-proposal/route.ts` | Auto-compare uses placeholder market id |

## What Grok Actually Does Today

1. **Market intel** (`POST /api/grok/intel`) — single-market analysis on detail page.
2. **Research agent** (`POST /api/research/agent`) — performance/snapshot context → text analysis.
3. **Runner periodic calls** — infrequent (`Math.random()` + time window); parses RECOMMENDED ACTIONS; can auto-apply temporary adjustments (expiration **buggy** — see STATUS.md).

**Does not do today:** emit structured `StrategyProposal[]` from model output.

## Historical Replay Prerequisites

1. Runner active on target market(s).
2. Snapshots in `market_snapshots`.
3. Select market + lookback on `/backtest`.

` snapshotCount === 0` is expected until sufficient soak time.

## Philosophy

Research is first-class in design. Several flywheel steps remain **implementation gaps** — see [CONTRIBUTING.md](../CONTRIBUTING.md#critical-blockers-fix-these-first).
