# Risk Philosophy & System

Risk management is the single most important part of this system.

## Core Beliefs

- Most "edges" in prediction markets are small or illusory after fees and slippage.
- Survival and consistency beat home runs.
- The system must protect itself when it is wrong.

## Risk Layers (Defense in Depth)

### 1. Portfolio Level (`PortfolioRiskManager`)
- Fractional Kelly sizing with confidence scaling
- Category exposure limits (crypto, politics, sports, etc.)
- Concentration penalties
- Max daily loss circuit breaker
- Max total exposure

### 2. Per-Market Execution Health (`ExecutionManager`)
- Tracks adverse fill rate and slippage per market
- Automatically downweights or pauses trading on markets with poor recent execution health
- This is one of the most powerful self-protection mechanisms

### 3. Strategy Allocator
- Dynamically increases or decreases size per strategy based on recent performance
- Prevents over-allocating to strategies that are currently degraded

### 4. Runner Self-Protection
- When many markets show poor execution health, the runner logs strong warnings and applies health multipliers
- Future: automatic global risk reduction or strategy pausing

## Why This Matters for 24/7

A system that runs unattended must be able to:
- Detect when it is getting adversely selected
- Reduce exposure on specific markets or strategies
- Avoid blowing up during regime shifts

This is why we treat execution quality as a first-class risk input, not just P&L.

## Recommended Settings (Conservative Starting Point)

For real capital:
- Start with `kellyFraction: 0.15–0.25`
- Strict category limits
- Health throttle threshold around 0.5

Paper mode can be more aggressive for research.
