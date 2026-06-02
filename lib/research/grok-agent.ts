/**
 * Grok Research Agent - Enhanced with Structured Proposals
 * 
 * Now capable of returning actionable, structured recommendations
 * that can be reviewed and potentially applied by the system.
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
  proposals?: StrategyProposal[];
  timestamp: Date;
  model: string;
}

export interface StrategyProposal {
  strategyId: string;
  type: 'parameter_change' | 'new_sub_strategy' | 'feature_addition' | 'regime_specific_rule';
  description: string;
  suggestedChange: Record<string, unknown>;
  expectedImpact: string;
  confidence: number; // 0-1
  regime?: string;
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
    temperature: 0.35,
  });

  // Try to extract structured proposals
  const proposals: StrategyProposal[] = [];
  // Structured proposal extraction can be added later with better prompting.
  // For now the free-text analysis is already extremely valuable.

  return {
    query,
    analysis: text,
    proposals: proposals.length > 0 ? proposals : undefined,
    timestamp: new Date(),
    model: MODEL,
  };
}

async function gatherResearchContext(query: ResearchQuery) {
  const lookback = query.lookbackHours || 48;
  const since = new Date(Date.now() - lookback * 3600 * 1000);

  const performance = await getStrategyPerformance(Math.ceil(lookback / 24));

  let snapshots: Record<string, unknown>[] = [];
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
    recentSnapshots: (context.recentSnapshots as Record<string, unknown>[])?.slice(-40) || snapshots.slice(-40),
    snapshotCount: (context.recentSnapshots as Record<string, unknown>[])?.length || snapshots.length,
    lookbackHours: lookback,
  };
}

function buildResearchPrompt(query: ResearchQuery, context: Record<string, unknown>): string {
  const base = `You are a world-class quantitative researcher for prediction market automated trading systems.

You have access to real order book snapshots (with imbalance, depth, micro-price, regime labels, etc.), performance attribution, and replay results.

Be extremely practical and data-driven. Focus on small, consistent edges rather than home-run ideas.

`;

  if (query.type === 'strategy_analysis') {
    return base + `
Analyze strategy "${query.strategyId}" over the last ${context.lookbackHours} hours.

Performance:
${JSON.stringify(context.performance, null, 2)}

Recent snapshot features (with regimes):
${JSON.stringify(context.recentSnapshots.slice(-12), null, 2)}

Deliver a sharp analysis of what is working / broken, and why.

At the end, output a section called "RECOMMENDED ACTIONS" with 0-5 concrete, executable recommendations in this exact format (one per line):
- ACTION: [pause_strategy | reduce_allocation | increase_allocation | enter_defensive_mode | cancel_orders_on_market | other] | TARGET: [strategy_id or market_id or "global"] | VALUE: [optional number, e.g. 0.5 for 50%] | REASON: [short explanation]
Example:
- ACTION: pause_strategy | TARGET: threshold | REASON: consistent underperformance and edge decay
- ACTION: reduce_allocation | TARGET: global | VALUE: 0.6 | REASON: system health is low and adverse selection is high`;
  }

  if (query.type === 'feature_ideas') {
    return base + `
From the recent snapshot data, propose 4-6 high-quality, computable features that would help strategies adapt to different regimes or capture small persistent edges.

Data sample:
${JSON.stringify(((context.recentSnapshots as unknown) as Record<string, unknown>[] || []).slice(0, 10), null, 2)}`;
  }

  if (query.type === 'regime_detection') {
    return base + `
Using the recent snapshots (which already contain some regime labels), refine our regime classification and suggest simple, robust real-time regime detection rules we can implement in code.

Recent data:
${JSON.stringify(((context.recentSnapshots as unknown) as Record<string, unknown>[] || []).slice(-20), null, 2)}`;
  }

  return base + `Research request: ${query.extraContext || 'Provide the most valuable insights possible from the data.'}`;
}
