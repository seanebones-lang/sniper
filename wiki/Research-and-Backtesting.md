# Research & Backtesting

**Status:** See [Project Status](Project-Status) (June 2, 2026).

**UI route:** `/backtest` — Research & Backtesting Lab

---

## The research flywheel

```
Runner collects snapshots          ✅ Works (throttled 1-in-3)
        ↓
Performance + execution data       ✅ Works (per-strategy PnL via paper_trades joins)
        ↓
Grok Research Agent                ✅ Works (text + structured proposals)
        ↓
Structured proposals               ✅ Works (JSON/PROPOSALS parsing)
        ↓
Strategy Variants                  ⚠️ In-memory only (lost on restart)
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

> **Note:** The "Realistic passive fill simulation" checkbox is **UI only** — the replay engine ignores this flag today. See [Known Issues](Known-Issues-and-Roadmap).

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
| Research agent | `POST /api/research/agent` | Performance/snapshot context → text + proposals |
| Runner periodic | (internal) | Parses RECOMMENDED ACTIONS; auto-apply pause/downweight |
| Structured proposals | `/api/research/agent` | **Works** — JSON/`PROPOSALS` parsing |
| Apply proposal | `POST /api/research/apply-proposal` | Creates in-memory variant |
| Apply recommendation | `POST /api/research/apply-recommendation` | Apply/ignore Grok rec; audited |

### Grok lab buttons (on `/backtest`)

1. **Analyze Current Strategy Performance**
2. **Suggest New Features from Recent Data**
3. **Detect Market Regimes**

Analyses are logged to audit events. RECOMMENDED ACTIONS (pause, reduce allocation, downweight) are parsed and can auto-apply.

---

## Backend components

| Component | File | Status |
|-----------|------|--------|
| Snapshot storage | `lib/data/historical.ts` | Works |
| Replay | `replayStrategyOnHistory()` | Works; no realistic fill mode |
| Features | `lib/data/features.ts` | Works |
| Grok agent | `lib/research/grok-agent.ts` | Text + JSON/`PROPOSALS` proposal parsing |
| RECOMMENDED ACTIONS | `lib/monitoring/ai-recommendations.ts` | Parsed from text; auto-apply |
| Performance | `lib/research/performance.ts` | Per-strategy PnL via `paper_trades` joins |
| Strategy PnL | `lib/paper/strategy-pnl.ts` | Fed to edge decay each cycle |
| Variants | `lib/strategies/variants.ts` | In-memory — persist to DB remains open |
| Apply proposal API | `/api/research/apply-proposal` | Creates variant (in-memory) |

---

## Historical replay prerequisites

1. Runner active on target market(s) for sufficient time
2. Snapshots accumulated in `market_snapshots`
3. Select market + lookback on `/backtest`

Use **Refresh List** on the market dropdown to pull current markets from `/api/markets`.

---

## Workflow recommendation

1. Run paper runner for 48–72+ hours on target markets
2. Monitor P&L on `/dashboard` or `/paper`
3. Run historical replay on `/backtest`
4. Trigger Grok analysis on underperforming strategies
5. If a variant is created, replay it before enabling live
6. Only consider real execution after consistent paper results

---

## Related pages

- [Strategies](Strategies)
- [UI Guide](UI-Guide)
- [Contributing](Contributing) — research flywheel gaps
