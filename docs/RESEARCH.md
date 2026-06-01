# Research & Edge Discovery

The long-term advantage in this game comes from the ability to **continuously discover, test, and improve edges** faster than the market.

## The Research Flywheel

1. Runner collects rich order book snapshots 24/7
2. Performance attribution + execution quality data is stored
3. Grok Research Agent analyzes the data and generates structured proposals
4. Proposals can be turned into Strategy Variants
5. Variants are automatically compared against base strategies via historical replay
6. Good variants can be promoted; bad ones rejected
7. Learnings feed back into better features and strategies

## Key Tools

- **Historical Replay Engine**: `lib/data/historical.ts` + `/api/research/replay`
- **Grok Research Agent**: `lib/research/grok-agent.ts` + UI in Research Lab
- **Variants System**: Create, test, and compare modified strategy configurations
- **Backtesting Lab**: `/backtest` page

## Grok Agent Capabilities

The agent can currently:
- Analyze why a strategy is winning or losing
- Propose parameter changes
- Suggest new features from snapshot data
- Detect regime issues
- Output structured proposals that can be applied as variants

Future direction: tighter closed-loop where the agent helps refine strategies based on actual replay results.

## Philosophy

We treat research as a first-class citizen, not an afterthought.

The goal is not to find one magic strategy, but to build a system that can keep finding and validating many small edges over time.
