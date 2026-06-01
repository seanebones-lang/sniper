# Execution Layer

This is where theoretical edge becomes (or fails to become) real money.

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

## Why This Matters

A strategy that looks good on P&L but has terrible average execution (constant adverse selection) will eventually lose money.

The ExecutionManager + health feedback loop is designed to catch this early and protect capital.
