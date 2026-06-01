/**
 * Grok Research Agent
 * 
 * This is one of the highest-leverage components for building a truly
 * advantageous, self-improving prediction market system.
 * 
 * It uses the rich data we collect (snapshots, performance attribution, replays)
 * and leverages Grok to:
 * - Analyze why strategies win or lose
 * - Propose new features or strategy tweaks
 * - Detect market regimes
 * - Generate hypotheses for new edges
 * 
 * This creates a real research flywheel.
 */

import { generateText } from 'ai';
import { xai } from '@ai-sdk/xai';
import { getStrategyPerformance } from './performance';
import { getSnapshotsForReplay } from '../data/historical';

const MODEL = 'grok-4';

export interface ResearchQuery {
  type: 'strategy_analysis' | 'regime_detection' | 'feature_ideas' | 'hypothesis_generation';
  strategyId?: string;
  platform?: string;
  marketExternalId?: string;
  lookbackHours?: number;
  extraContext?: string;
}

export interface ResearchResult {
  query: ResearchQuery;
  analysis: string;
  timestamp: Date;
  model: string;
}

/**
 * Main entry point for the Research Agent.
 */
export async function askGrokResearchAgent(query: ResearchQuery): Promise<ResearchResult> {
  if (!process.env.XAI_API_KEY) {
    throw new Error('XAI_API_KEY is required for the Grok Research Agent');
  }

  const context = await gatherResearchContext(query);

  const prompt = buildResearchPrompt(query, context);

  const { text } = await generateText({
    model: xai(MODEL),
    prompt,
    temperature: 0.4, // slightly more analytical than creative
  });

  return {
    query,
    analysis: text,
    timestamp: new Date(),
    model: MODEL,
  };
}

async function gatherResearchContext(query: ResearchQuery) {
  const lookback = query.lookbackHours || 48;
  const since = new Date(Date.now() - lookback * 3600 * 1000);

  const performance = await getStrategyPerformance(Math.ceil(lookback / 24));

  let snapshots: any[] = [];
  if (query.platform && query.marketExternalId) {
    snapshots = await getSnapshotsForReplay(
      query.platform,
      query.marketExternalId,
      since,
      new Date()
    );
  }

  return {
    performance,
    recentSnapshots: snapshots.slice(-30), // last 30 snapshots for context
    snapshotCount: snapshots.length,
    lookbackHours: lookback,
  };
}

function buildResearchPrompt(query: ResearchQuery, context: any): string {
  const base = `You are an expert quantitative researcher specializing in prediction market microstructure and automated trading systems.

You have access to:
- Recent performance attribution for strategies
- High-resolution order book snapshots (imbalance, depth, micro-price, etc.)
- Replay results from historical data

Current query type: ${query.type}

`;

  if (query.type === 'strategy_analysis') {
    return base + `
Analyze the recent performance of strategy "${query.strategyId || 'unknown'}".

Performance data (last ${context.lookbackHours}h):
${JSON.stringify(context.performance, null, 2)}

Recent snapshot features (sample):
${JSON.stringify(context.recentSnapshots.slice(0, 8), null, 2)}

Provide:
1. Why this strategy is likely winning or losing right now
2. Any visible regime issues (e.g., only works in high-imbalance environments)
3. Specific, actionable recommendations to improve it
4. Risk of overfitting or degradation

Be direct and data-driven.`;
  }

  if (query.type === 'feature_ideas') {
    return base + `
Based on the recent order book snapshots below, propose 3-5 new, computable features that could improve existing strategies or form the basis of new ones.

Recent snapshots:
${JSON.stringify(context.recentSnapshots, null, 2)}

For each proposed feature, include:
- Name
- How to calculate it from snapshots
- Why it might have predictive power in prediction markets
- Which current strategy it would most help`;
  }

  if (query.type === 'regime_detection') {
    return base + `
Analyze the recent snapshot data for signs of different market regimes (high vs low liquidity, trending vs mean-reverting imbalance, news-driven vs quiet periods, etc.).

Recent snapshots:
${JSON.stringify(context.recentSnapshots, null, 2)}

Identify:
- Clear regime shifts in the data
- Which regimes current strategies are likely to perform well or poorly in
- Simple rules or signals that could be used to detect the current regime in real time`;
  }

  return base + `General research request: ${query.extraContext || 'Provide any interesting insights from the available performance and snapshot data.'}`;
}

/**
 * Convenience method for common research tasks.
 */
export async function analyzeStrategyPerformance(strategyId: string, hours = 48) {
  return askGrokResearchAgent({
    type: 'strategy_analysis',
    strategyId,
    lookbackHours: hours,
  });
}
