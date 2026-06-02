# UI Guide

Walkthrough of every page in the Sniper web interface.

Paper mode is the default throughout. A red risk banner appears on every page.

---

## Landing (`/`)

Entry point with project overview and navigation.

| Element | Action |
|---------|--------|
| **Open Dashboard** | Go to `/dashboard` |
| **View on GitHub** | Link to repo |

Feature cards explain paper mode default, auditable decisions, and 24/7 design.

---

## Dashboard (`/dashboard`)

Central hub with system stats and navigation cards.

### Summary cards

| Card | Meaning |
|------|---------|
| Risk Mode | Current mode (NORMAL / DEFENSIVE / EMERGENCY) |
| Active Strategies | Count of enabled strategies |
| Paper Fills (3d) | Recent simulated trades |
| Execution Health | System health score |

### Navigation cards

| Card | Route | Purpose |
|------|-------|---------|
| Markets | `/markets` | Browse Polymarket & Kalshi |
| Strategies & Runner | `/strategies` | Create strategies, start runner |
| Backtester | `/backtest` | Synthetic + historical replay |
| System Health | `/health` | Risk mode, execution quality |
| Settings | `/settings` | Grok key, research agent toggle |
| Real Execution | `/real` | Real money warnings and gate |

---

## Markets (`/markets`)

Browse active markets from Polymarket and Kalshi.

- Filter/search by platform
- View last prices and volume
- Click any market → detail page

### Market detail (`/markets/[platform]/[id]`)

| Feature | Notes |
|---------|-------|
| Order book | Bid/ask levels with sizes |
| Last price | From REST API |
| Manual paper fill | **Reliable fill path** — persists to DB |
| Grok intel | Single-market analysis (requires xAI key) |
| Live WebSocket | Polymarket only on detail page |

---

## Strategies (`/strategies`)

Manage automated trading rules and the 24/7 runner.

### How it works

1. **Create** a strategy and pick a rule type
2. **Activate** it in the table (starts paused)
3. **Start the runner** — checks markets every ~12 seconds

### Runner status bar

Shows: Runner state (RUNNING/STOPPED), last run time, signal count, paper fill count.

### Strategy table

| Column | Meaning |
|--------|---------|
| Name | User-defined label |
| Type | Strategy rule type |
| Max / trade | `maxSizeUsd` |
| Key setting | Primary config (e.g. min spread %) |
| Status | PAUSED/ACTIVE + paper/real mode |

### Create strategy form

Fields vary by strategy type. All new strategies are paper-only. See [Strategies](Strategies) for field meanings.

> Automated runner fills are currently blocked. Use manual paper fills on market detail pages.

---

## Backtest (`/backtest`)

Research & Backtesting Lab — see [Research & Backtesting](Research-and-Backtesting).

| Section | Purpose |
|---------|---------|
| Synthetic price series | Test strategy against custom prices |
| Historical replay | Replay against saved order book snapshots |
| Grok research agent | AI analysis buttons |
| Recent proposals | Grok-generated strategy suggestions |

---

## Health (`/health`)

Live view of system state.

| Section | Content |
|---------|---------|
| Current Risk Mode | Mode badge + multiplier + reason |
| Recent Performance | Signal/fill counts by period |
| Active Variants | In-memory strategy overrides |
| Execution Health | Health score, slippage, unhealthy markets |
| Grok Recommendations | Pending/applied automated intelligence |
| Temporary Adjustments | Auto-applied risk changes from Grok |

---

## Settings (`/settings`)

| Setting | Storage |
|---------|---------|
| Grok (xAI) API key | `data/user-settings.json` or `XAI_API_KEY` env |
| Enable research agent | Toggle for periodic runner Grok calls |

Env vars override file storage.

---

## Real execution (`/real`)

Mandatory safety gate before real capital.

| Element | Purpose |
|---------|---------|
| Risk warning box | Lists real capital risks |
| Current status | Shows DISABLED unless env flag set |
| Confirmation phrase | Type exact phrase to proceed |

Requires `SNIPER_ENABLE_REAL_EXECUTION=true` server-side. Page does not yet read live server flag (known issue).

---

## Screenshots

See [Screenshots](Screenshots) for visual reference of each page.

---

## Related pages

- [Getting Started](Getting-Started)
- [Strategies](Strategies)
- [API Reference](API-Reference)
