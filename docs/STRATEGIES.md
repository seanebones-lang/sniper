# Strategies

Five built-in strategies ship with Sniper. All are **paper-only by default** when created via the UI.

Configure them at **`/strategies`** → Create Strategy.

## Built-in Strategies

### 1. Wide Spread Scalper (`spread-scalper`)

- **Idea:** Enter when bid/ask spread is wide enough to capture edge after fees.
- **Key config:** `minSpreadPct` — minimum spread % to trigger.
- **Returns:** `edge` derived from spread for Kelly sizing.

### 2. Price Threshold (`threshold`)

- **Idea:** Buy when price drops below an entry threshold; sell at profit target.
- **Key config:** `entryThreshold` — buy below this price (0–1 decimal).

### 3. Order Book Imbalance (`orderbook-imbalance`)

- **Idea:** Trade when one side of the book has significantly more size than the other.
- **Key config:** Uses `maxSizeUsd`; thresholds adapt to `ctx.regime` from snapshot features.

### 4. Resolution Proximity Sniper (`resolution-proximity`)

- **Idea:** Strong directional pressure near the end of short-duration markets.
- **Key config:** Uses `market.endDate` when available; volume proxy fallback.

### 5. Live Quick Flip (`live-quick-flip`)

- **Idea:** Fast in-and-out on markets resolving within ~3 hours (sports, near-term events).
- **Key config:** `tradingGoal: quick-flip`, `targetProfitMultiple`, `maxHoldSeconds`.

## Common Config Fields

| Field | Meaning | Example |
|-------|---------|---------|
| `maxSizeUsd` | Max notional per trade | `150` |
| `targetProfitPct` | Target profit % for exits | `2.8` |
| `cooldownSeconds` | Min seconds between signals (enforced in runner) | `180` |
| `allocationDownweight` | Durable size multiplier from Grok | `0.5` |
| `tradingGoal` | `quick-flip`, `spread-capture`, etc. | `quick-flip` |

## Strategy System Features

- **Allocator** — PnL + activity weighted sizing
- **Risk mode awareness** — DEFENSIVE/EMERGENCY reduces markets and filters strategies
- **Regime awareness** — `StrategyContext.regime` from recent snapshots
- **Exit engine** — take profit / stop loss / max hold before new entries
- **Edge + confidence** — returned for Kelly sizing in risk manager

## Adding a New Strategy

1. Create `lib/strategies/my-strategy.ts` implementing `Strategy`.
2. Register in `lib/strategies/index.ts`.
3. Add tests with mock order book contexts.

See [STATUS.md](./STATUS.md) for verified runner integration.
