/**
 * Strategy Proposals Store
 *
 * Allows the Grok Research Agent to propose changes that can be reviewed
 * and (in the future) automatically tested or applied.
 */

import { db, auditEvents } from '@/lib/db';
import type { StrategyProposal, ResearchQuery } from '@/lib/research/grok-agent';

export interface StoredProposal {
  id?: string;
  strategyId: string;
  type: string;
  description: string;
  suggestedChange: Record<string, unknown>;
  expectedImpact: string;
  confidence: number;
  regime?: string;
  status: 'proposed' | 'reviewed' | 'testing' | 'applied' | 'rejected';
  createdAt: Date;
}

export async function saveProposals(proposals: StrategyProposal[], sourceQuery: ResearchQuery) {
  for (const p of proposals) {
    await db.insert(auditEvents).values({
      actor: 'grok-research-agent',
      action: 'strategy_proposal',
      payload: {
        ...p,
        sourceQuery,
        status: 'proposed',
      },
    });
  }
}

export async function getRecentProposals(limit = 20) {
  const events = await db.query.auditEvents.findMany({
    where: (e, { eq }) => eq(e.action, 'strategy_proposal'),
    orderBy: (e, { desc }) => desc(e.createdAt),
    limit,
  });

  return events.map(e => e.payload);
}
