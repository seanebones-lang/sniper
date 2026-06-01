# Strategies

Current production strategies (as of latest build):

## 1. Wide Spread Scalper
- Enters when book spread is sufficiently wide
- Simple but effective in certain liquidity conditions

## 2. Price Threshold
- Basic mean-reversion / value approach
- Buys below a threshold, sells on target

## 3. Order Book Imbalance
- Looks for significant pressure on one side of the book
- Now regime-aware (more aggressive in trending regimes)

## 4. Resolution Proximity Sniper
- Targets the final portion of short-duration markets
- One of the more reliable simple edges on 5m/15m/1h crypto markets

## Strategy System Features

- **Allocator**: Dynamically sizes strategies based on recent performance
- **Risk Mode Awareness**: Strategy selection and evaluation limits change automatically based on current risk mode (NORMAL / DEFENSIVE / EMERGENCY)
- **Regime Awareness**: Several strategies change behavior based on detected regimes
- **Variants + Grok Proposals**: Grok can propose changes that become testable variants. Low-risk recommendations can be auto-applied temporarily.

## Adding New Strategies

See `lib/strategies/` for examples. Strategies implement a simple `evaluate(ctx, config)` interface and should return `edge` + `confidence` when possible so the risk system can use them intelligently.

## Philosophy

We prefer several small, somewhat uncorrelated edges over one "perfect" strategy.

The allocator + risk system is designed to let good edges grow and automatically reduce exposure to edges that are currently degraded.
