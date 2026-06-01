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

### 2. Explicit Risk Modes (`RiskModeManager`)
The runner automatically shifts between three modes based on system health, adverse execution rate, and edge decay:

- **NORMAL**: Full operation
- **DEFENSIVE**: Fewer markets, extra sizing conservatism, weaker strategies deprioritized
- **EMERGENCY**: Extremely restricted (1–2 markets, only the strongest strategies). Most strategies are paused.

Risk mode changes are logged and visible in the health dashboard.

### 3. Temporary Adjustments System
The Grok Research Agent can propose temporary risk changes (global risk reduction, strategy downweighting, etc.). These are automatically applied with expiration when safe, and revert automatically.

### 4. Per-Market Execution Health (`ExecutionManager`)
- Tracks adverse fill rate and slippage per market in real time
- Automatically downweights unhealthy markets
- Provides recommendations for canceling resting orders

### 5. Strategy Allocator + Edge Decay Monitoring
- Dynamically sizes strategies based on recent performance
- Detects edge decay and feeds it into risk mode decisions

### 6. Runner Self-Protection
The runner actively combines all signals above and applies health multipliers + behavioral restrictions in real time.

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
