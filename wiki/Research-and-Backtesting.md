# Research & Backtesting

**Status:** See [Project Status](Project-Status).

**UI route:** `/backtest` — Research & Backtesting Lab

---

## The research flywheel (intended)

```
Runner collects snapshots          ✅ Works
        ↓
Performance + execution data       ⚠️ Partial (attribution placeholder)
        ↓
Grok Research Agent                ✅ Works (text output)
        ↓
Structured proposals             ❌ NOT implemented (proposals[] always empty)
        ↓
Strategy Variants                  ⚠️ In-memory only
        ↓
Historical replay                  ✅ Works if snapshots exist
        ↓
Promote / reject                   Manual
```

---

## Backtest lab sections

### Synthetic price series

- Enter comma-separated prices in cents (e.g. `0.45, 0.46, 0.44, 0.43`)
- Select a strategy type
- Click **Run Synthetic Backtest**
- Runs in-process; no database required

### Historical order book replay

- Requires runner-collected snapshots in `market_snapshots`
- Select strategy, market, lookback period, optional variant
- Click **Run Historical Replay**
- `snapshotCount === 0` is expected until sufficient runner soak time (48h+ recommended)

> **Note:** The "Realistic passive fill simulation" checkbox is **UI only** — the replay engine ignores this flag today.

---

## Grok / xAI setup

| Method | Location |
|--------|----------|
| Settings UI | `/settings` → stores in `data/user-settings.json` (gitignored) |
| Environment | `XAI_API_KEY` overrides file |
| Runner periodic | `ENABLE_GROK_RESEARCH_AGENT=true` |

Get a key from [console.x.ai](https://console.x.ai).

---

## What Grok does today

| Feature | Endpoint | Status |
|---------|----------|--------|
| Market intel | `POST /api/grok/intel` | Single-market analysis on detail page |
| Research agent | `POST /api/research/agent` | Performance/snapshot context → text |
| Runner periodic | (internal) | Infrequent; parses RECOMMENDED ACTIONS |
| Structured proposals | — | **Not implemented** |

### Grok lab buttons (on `/backtest`)

1. **Analyze Current Strategy Performance**
2. **Suggest New Features from Recent Data**
3. **Detect Market Regimes**

Analyses are logged to audit events. Structured `proposals[]` in API responses are always empty until parsing is implemented.

---

## Backend components

| Component | File | Status |
|-----------|------|--------|
| Snapshot storage | `lib/data/historical.ts` | Works |
| Replay | `replayStrategyOnHistory()` | Works; no realistic fill mode |
| Features | `lib/data/features.ts` | Works |
| Grok agent | `lib/research/grok-agent.ts` | Text works; proposals[] empty |
| RECOMMENDED ACTIONS | `lib/monitoring/ai-recommendations.ts` | Parsed from text |
| Variants | `lib/strategies/variants.ts` | In-memory |
| Apply proposal API | `/api/research/apply-proposal` | Placeholder compare market |

---

## Historical replay prerequisites

1. Runner active on target market(s) for sufficient time
2. Snapshots accumulated in `market_snapshots`
3. Select market + lookback on `/backtest`

Use **Refresh List** on the market dropdown to pull current markets from `/api/markets`.

---

## Workflow recommendation

1. Run paper runner for 48–72+ hours on target markets
2. Run historical replay on `/backtest`
3. Trigger Grok analysis on underperforming strategies
4. If a variant is created, replay it before enabling live
5. Only consider real execution after consistent paper results

---

## Related pages

- [Strategies](Strategies)
- [UI Guide](UI-Guide)
- [Contributing](Contributing) — research flywheel gaps
