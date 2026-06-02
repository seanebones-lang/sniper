# API Reference

All routes are **unauthenticated** — Sniper is designed as a personal tool. Add auth if deploying multi-user.

Base URL: your deployment origin (e.g. `http://localhost:3000` or Railway URL).

---

## Health & system

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | System health JSON (risk mode, execution health, runner cycle timing, recent audits) |

---

## Markets

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/markets` | Market discovery (Polymarket + Kalshi) |
| GET | `/api/markets/orderbook` | Order book + metadata for a market |

**Query params (orderbook):**
- `platform` — `polymarket` or `kalshi`
- `id` — market/ticker ID
- `externalId` — CLOB token ID (Polymarket)

---

## Strategies

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/strategies` | List all strategies |
| POST | `/api/strategies` | Create strategy (paper-only by default) |
| PATCH | `/api/strategies/[id]` | Toggle active, update config |
| GET | `/api/strategies/variants` | List in-memory strategy variants |

---

## Runner

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/runner` | Runner status (running, last run, signal/fill counts). Optional `?includePnl=1` |
| POST | `/api/runner` | Start or stop runner (`{ "action": "start" }` or `"stop"`) |

Runner evaluates markets on a **4–12s adaptive interval** when active.

---

## Paper trading

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/paper/portfolio` | Full portfolio snapshot (positions, equity, P&L) |
| GET | `/api/paper/pnl` | Lightweight P&L only (ledger + MTM snapshot) |
| POST | `/api/paper/fill` | Manual paper fill → `paper_trades` |

**Example body (`POST /api/paper/fill`):**
```json
{
  "platform": "polymarket",
  "marketId": "...",
  "externalId": "...",
  "side": "buy",
  "price": 0.45,
  "sizeUsd": 10,
  "outcome": "Yes"
}
```

Both manual fills and runner automated fills persist to `paper_trades`. P&L is computed via ledger + mark-to-market.

---

## Settings

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/settings` | Grok key status + research agent toggle |
| POST | `/api/settings` | Save Grok key and toggle (file storage) |

Server-side secrets (`POLYMARKET_PRIVATE_KEY`, Kalshi keys, etc.) are never exposed via this API.

---

## Grok & research

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/grok/intel` | Single-market Grok analysis |
| POST | `/api/research/agent` | Grok research agent (performance context + structured proposals) |
| POST | `/api/research/replay` | Historical strategy replay |
| GET | `/api/research/proposals` | Proposal audit events |
| GET | `/api/research/performance` | Per-strategy attribution + PnL |
| POST | `/api/research/apply-proposal` | Create variant from proposal |
| POST | `/api/research/apply-recommendation` | Apply/ignore Grok recommendation |

---

## UI routes (pages)

| Route | Purpose |
|-------|---------|
| `/` | Landing |
| `/dashboard` | Stats + paper P&L hub |
| `/paper` | Paper portfolio + P&L breakdown |
| `/markets` | Market discovery |
| `/markets/[platform]/[id]` | Order book, manual paper fill, Grok intel, live WS |
| `/strategies` | Strategies + runner control |
| `/backtest` | Synthetic + historical replay, Grok lab |
| `/settings` | Grok API key + research agent toggle |
| `/health` | Risk mode, execution health, recommendations |
| `/real` | Real execution warnings (placeholder status UI) |

See [UI Guide](UI-Guide) for page-by-page walkthrough.

---

## Smoke tests

`scripts/smoke-test.mjs` exercises 14 API checks. Run with dev server:

```bash
npm run dev &
npm run test:smoke
```

Set `SMOKE_BASE_URL` if not using default port.

---

## Related pages

- [Architecture](Architecture)
- [Project Status](Project-Status)
- [Getting Started](Getting-Started)
