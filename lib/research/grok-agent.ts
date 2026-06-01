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
import { z } from 'zod';

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
  suggestedChange: Record<string, any>;
  expectedImpact: string;
  confidence: number; // 0-1
  regime?: string;
}

const ProposalSchema = z.object({
  proposals: z.array(z.object({
    strategyId: z.string(),
    type: z.enum(['parameter_change', 'new_sub_strategy', 'feature_addition', 'regime_specific_rule']),
    description: z.string(),
    suggestedChange: z.record(z.any()),
    expectedImpact: z.string(),
    confidence: z.number().min(0).max(1),
    regime: z.string().optional(),
  }))
});

/**
 * Main entry point for the Research Agent.
 * Now attempts to extract structured proposals when possible.
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
  let proposals: StrategyProposal[] = [];
  try {
    // Ask Grok for a clean JSON block at the end for proposals
    const proposalPrompt = `${prompt}\n\nAt the very end, output ONLY a JSON object with this exact shape (no other text):\n` +
      `{"proposals": [{"strategyId": "...", "type": "parameter_change|new_sub_strategy|feature_addition|regime_specific_rule", "description": "...", "suggestedChange": {...}, "expectedImpact": "...", "confidence": 0.0-1.0, "regime": "optional"}]}`;

    const { text: proposalText } = await generateText({
      model: xai(MODEL),
      prompt: proposalPrompt,
      temperature: 0.2,
    });

    const jsonMatch = proposalText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const validated = ProposalSchema.safeParse(parsed);
      if (validated.success) {
        proposals = validated.data.proposals;
      }
    }
  } catch (e) {
    // Structured proposals are optional — don't fail the whole analysis
    console.warn('[Grok Agent] Could not extract structured proposals:', e);
  }

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
    recentSnapshots: snapshots.slice(-40),
    snapshotCount: snapshots.length,
    lookbackHours: lookback,
  };
}

function buildResearchPrompt(query: ResearchQuery, context: any): string {
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

Deliver a sharp analysis of what is working / broken, and why.`;
  }

  if (query.type === 'feature_ideas') {
    return base + `
From the recent snapshot data, propose 4-6 high-quality, computable features that would help strategies adapt to different regimes or capture small persistent edges.

Data sample:
${JSON.stringify(context.recentSnapshots.slice(0, 10), null, 2)}`;
  }

  if (query.type === 'regime_detection') {
    return base + `
Using the recent snapshots (which already contain some regime labels), refine our regime classification and suggest simple, robust real-time regime detection rules we can implement in code.

Recent data:
${JSON.stringify(context.recentSnapshots.slice(-20), null, 2)}`;
  }

  return base + `Research request: ${query.extraContext || 'Provide the most valuable insights possible from the data.'}`;
}
