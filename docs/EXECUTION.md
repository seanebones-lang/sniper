# Execution Layer

This is where theoretical edge becomes (or fails to become) real money.

> **June 2026 Reliability Fix**: The automated runner → signal → paper fill pipeline (previously blocked by `signals.market_id` FK issues) is now functional. See `lib/db/ensure-market.ts`, updates to `lib/markets.ts` + `lib/runner/engine.ts`, and the authoritative `docs/STATUS.md`.

## Philosophy

In prediction markets, **execution quality is often the difference between a positive and negative edge**.

Most systems focus too much on signal generation and not enough on how they actually interact with the order book.

## ExecutionManager (The Brain)

`lib/execution/execution-manager.ts` is the single place that decides:

- Passive vs Aggressive
- When to cancel resting orders
- Adverse selection detection and response
- Execution quality scoring

### Key Behaviors

- **Passive preference on real capital**: We try to post limits when reasonable to reduce taker fees and improve average price.
- **Adverse selection awareness**: Fast fills followed by immediate price movement against us are treated as warning signs.
- **Per-market health tracking**: Markets with sustained poor fills get automatically downweighted by the runner.
- **Lifecycle management**: The manager knows about open orders and can recommend cancellations.

## Current Capabilities (as of latest build)

Real execution paths benefit from durable risk snapshots (including exposure and maxDrawdown), active exchange polling in reconciliation (Kalshi + basic Polymarket), and `recordRealFill` now defensively ensuring market records before writing positions.

- Central `ExecutionManager` that decides passive vs aggressive for every signal
- Real passive order lifecycle management (`handleBookUpdate`, `manageRestingOrders`)
- Adverse selection detection with automatic response recommendations
- Per-market execution health tracking (used for automatic downweighting)
- Integration with Risk Modes and Temporary Adjustments from Grok
- Realistic passive fill simulation in paper mode and replay engine
- Execution quality scoring exposed in `/health`

## Future / High Priority

- True queue simulation for paper mode (realistic passive fill probabilities)
- Resting order management (adjust/cancel logic based on new book information)
- Venue-specific execution profiles (Polymarket CLOB vs Kalshi)
- Fill quality attribution back into strategy evaluation
- **Real execution reconciliation** (basic version added June 2026 — see `lib/execution/reconcile-real-trades.ts`)

## Why This Matters

A strategy that looks good on P&L but has terrible average execution (constant adverse selection) will eventually lose money.

The ExecutionManager + health feedback loop is designed to catch this early and protect capital.

**Note (June 2026):** Real execution for Kalshi now has a trading client skeleton and basic reconciliation support. Full position tracking and kill-switches remain high-priority future work.
