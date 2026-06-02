# Strategies

Five built-in strategies ship with Sniper (including **live-quick-flip**). All are **paper-only by default** when created via the UI.

Configure them at **`/strategies`** → **+ New Strategy**.

---

## Built-in strategies

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

- **Idea:** Strong directional pressure near the end of short-duration markets.
- **Key config:** Uses `market.endDate` when available; volume proxy fallback.

### 5. Live Quick Flip (`live-quick-flip`)

- **Idea:** Fast in-and-out on markets resolving within ~3 hours.
- **Key config:** `tradingGoal: quick-flip`, `targetProfitMultiple`, `maxHoldSeconds`.

---

## Common config fields

All strategies share these (set in the create form):

| Field | Meaning | Example |
|-------|---------|---------|
| `maxSizeUsd` | Max notional per trade | `150` |
| `targetProfitPct` | Target profit % for exits | `2.8` |
| `cooldownSeconds` | Min seconds between signals on same market | `180` |
| `minSpreadPct` | *(spread-scalper only)* Min spread to enter | `1.9` |
| `entryThreshold` | *(threshold only)* Buy below this price | `0.48` |

Stored in DB as JSON in `strategies.config`.

---

## How strategies participate

1. **Create** a strategy on `/strategies` — starts **paused**.
2. **Activate** via the table toggle.
3. **Start the runner** on `/paper` — adaptive 4–12s interval (quick-flip uses 4s target).
4. Only **ACTIVE** strategies are evaluated.

Automated paper fills persist to `paper_trades` with ledger + MTM P&L on `/dashboard`.

---

## Strategy system features

| Feature | Status | Notes |
|---------|--------|-------|
| Allocator | Works | PnL + activity weighted sizing |
| Risk mode awareness | Works | DEFENSIVE/EMERGENCY filters weak strategies |
| Regime awareness | Works | `StrategyContext.regime` from snapshot features |
| Cooldown | Works | Enforced per strategy/market in runner |
| Variants | Partial | Grok proposals → in-memory overrides only |
| Edge + confidence | Supported | Strategies should return these for smarter sizing |

---

## Adding a new strategy

1. Create `lib/strategies/my-strategy.ts`:

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
3. Add description to `STRATEGY_DESCRIPTIONS` in `app/strategies/page.tsx`.
4. Add unit tests with mock `StrategyContext` + order book.
5. Document here and in repo `docs/STRATEGIES.md`.

---

## Testing strategies

| Method | Route | Notes |
|--------|-------|-------|
| Synthetic backtest | `/backtest` | Enter price series in cents; no DB |
| Historical replay | `/backtest` | Requires runner-collected snapshots |
| Live paper | `/strategies` + `/health` | Start runner; watch fills on market detail |

---

## Philosophy

Prefer several small, somewhat uncorrelated edges over one "perfect" strategy.

The allocator + risk system lets good edges grow and automatically reduces exposure to degraded edges.

---

## Related pages

- [UI Guide](UI-Guide) — strategies page walkthrough
- [Research & Backtesting](Research-and-Backtesting) — validate before going live
- [Risk Management](Risk-Management) — how risk modes affect strategies
