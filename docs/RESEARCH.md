# Research & Edge Discovery

**Status:** [STATUS.md](./STATUS.md)

## The Research Flywheel

```
Runner collects snapshots (works — throttled 1-in-3)
        ↓
Performance + per-strategy PnL (works — paper_trades → signals joins)
        ↓
Grok Research Agent (works — text + JSON proposals)
        ↓
RECOMMENDED ACTIONS auto-apply (works — audited temporary adjustments)
        ↓
Strategy Variants (in-memory only — persistence gap)
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
| Grok proposals list | Parsed from JSON/`PROPOSALS` blocks when model returns them |
| “Realistic passive fills” checkbox | **UI only** — replay engine ignores flag |

## Grok / xAI Setup

- **Settings UI** (`/settings`) → `data/user-settings.json` (gitignored)
- **Env:** `XAI_API_KEY` overrides file; `ENABLE_GROK_RESEARCH_AGENT=true` for runner periodic calls

## Backend Components

| Component | File | Status |
|-----------|------|--------|
| Snapshot storage | `lib/data/historical.ts` | Works |
| Replay | `replayStrategyOnHistory()` | Works; no realistic fill mode |
| Features | `lib/data/features.ts` | Works — regime from snapshots |
| Grok agent | `lib/research/grok-agent.ts` | Text + proposal parsing |
| RECOMMENDED ACTIONS | `lib/monitoring/ai-recommendations.ts` | Parsed + auto-applied |
| Performance | `lib/research/performance.ts` | Per-strategy PnL |
| Variants | `lib/strategies/variants.ts` | In-memory |
| Apply proposal API | `app/api/research/apply-proposal/route.ts` | Works |

## What Grok Does Today

1. **Market intel** (`POST /api/grok/intel`) — single-market analysis on detail page.
2. **Research agent** (`POST /api/research/agent`) — performance/snapshot context → analysis + proposals.
3. **Runner periodic calls** — infrequent; parses RECOMMENDED ACTIONS; auto-applies safe adjustments with expiration.

## Historical Replay Prerequisites

1. Runner active on target market(s).
2. Snapshots in `market_snapshots`.
3. Select market + lookback on `/backtest`.

`snapshotCount === 0` is expected until sufficient soak time.

## Philosophy

Research is first-class. Remaining gaps: variant persistence, replay passive fill realism, runner integration tests — see [CONTRIBUTING.md](../CONTRIBUTING.md).
