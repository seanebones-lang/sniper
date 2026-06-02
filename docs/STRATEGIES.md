# Strategies

Four built-in strategies ship with Sniper. All are **paper-only by default** when created via the UI.

Configure them at **`/strategies`** → Create Strategy. Form fields are labeled with hints explaining each parameter.

## Built-in Strategies

### 1. Wide Spread Scalper (`spread-scalper`)

- **Idea:** Enter when bid/ask spread is wide enough to capture edge after fees.
- **Key config:** `minSpreadPct` — minimum spread % to trigger.
- **Best for:** Liquid markets where spreads occasionally widen.

### 2. Price Threshold (`threshold`)

- **Idea:** Buy when price drops below an entry threshold; sell at profit target.
- **Key config:** `entryThreshold` — buy below this price (0–1 decimal, e.g. 0.48 = 48¢).
- **Best for:** Markets you believe are temporarily cheap.

### 3. Order Book Imbalance (`orderbook-imbalance`)

- **Idea:** Trade when one side of the book has significantly more size than the other.
- **Key config:** Uses `maxSizeUsd`; thresholds adapt to `ctx.regime`.
- **Best for:** Order-driven markets with visible pressure before price moves.

### 4. Resolution Proximity Sniper (`resolution-proximity`)

- **Idea:** Strong directional pressure near the end of short-duration markets (5m–1h).
- **Key config:** Uses volume/liquidity proxy for "time progress" until real `endDate` metadata exists.
- **Best for:** Short-term crypto/event markets close to resolution.

## Common Config Fields

All strategies share these (set in the create form):

| Field | Meaning | Example |
|-------|---------|---------|
| `maxSizeUsd` | Max notional per trade | `150` |
| `targetProfitPct` | Target profit % for exits | `2.8` |
| `cooldownSeconds` | Min seconds between signals on same market | `180` |
| `minSpreadPct` | *(spread-scalper only)* Min spread to enter | `1.9` |
| `entryThreshold` | *(threshold only)* Buy below this price | `0.48` |

Stored in DB as JSON in `strategies.config`.

## Strategy System Features

- **Allocator** (`lib/strategies/allocator.ts`) — dynamically sizes strategies from recent performance
- **Risk mode awareness** — DEFENSIVE/EMERGENCY reduces markets evaluated and filters weak strategies
- **Regime awareness** — `StrategyContext.regime` from snapshot features
- **Variants** — Grok proposals → testable config overrides *(in-memory store today)*
- **Edge + confidence** — strategies should return these when possible for smarter risk sizing

## Adding a New Strategy

1. Create `lib/strategies/my-strategy.ts` implementing `Strategy`:

```typescript
import type { Strategy, StrategySignal } from './types';

export const MyStrategy: Strategy = {
  id: 'my-strategy',
  name: 'My Strategy',
  type: 'my-strategy',
  evaluate(ctx, config): StrategySignal | null {
    // return { action, price, size, reason, confidence?, edge? } or null
  },
};
```

2. Register in `lib/strategies/index.ts`.
3. Add description to `STRATEGY_DESCRIPTIONS` in `app/strategies/page.tsx` (UI hints).
4. Add unit tests with mock `StrategyContext` + order book.
5. Document in this file.

## Philosophy

Prefer several small, somewhat uncorrelated edges over one "perfect" strategy.

The allocator + risk system lets good edges grow and automatically reduces exposure to degraded edges.

## Testing Strategies

- **Synthetic backtest:** `/backtest` → enter price series in cents, run locally (no DB).
- **Historical replay:** `/backtest` → pick market + lookback; requires runner-collected snapshots.
- **Live paper:** Start runner on Strategies page; watch `/health` and paper fills on market detail.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for known strategy-system gaps.
