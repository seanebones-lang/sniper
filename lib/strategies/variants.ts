/**
 * Strategy Variants System
 * 
 * This allows the Grok Research Agent (and humans) to propose and test
 * variations of strategies without polluting the main strategy list.
 * 
 * Variants can be A/B tested in replay and promoted to production.
 */

export interface StrategyVariant {
  id: string;
  baseStrategyId: string;
  name: string;
  description: string;
  configOverrides: Record<string, unknown>;
  source: 'grok_proposal' | 'manual';
  status: 'proposed' | 'testing' | 'promoted' | 'rejected';
  createdAt: Date;
  performance?: {
    replayPnl: number;
    trades: number;
    winRate: number;
    maxDD: number;
  };
}

const variantsStore: StrategyVariant[] = [];

export function createVariantFromProposal(proposal: Record<string, unknown>): StrategyVariant {
  const variant: StrategyVariant = {
    id: `variant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    baseStrategyId: proposal.strategyId as string,
    name: `${proposal.strategyId as string} - ${proposal.type as string} variant`,
    description: proposal.description as string,
    configOverrides: proposal.suggestedChange as Record<string, unknown>,
    source: 'grok_proposal',
    status: 'proposed',
    createdAt: new Date(),
  };

  variantsStore.push(variant);
  return variant;
}

export function getAllVariants(): StrategyVariant[] {
  return [...variantsStore];
}

export function getVariantsForStrategy(baseStrategyId: string): StrategyVariant[] {
  return variantsStore.filter(v => v.baseStrategyId === baseStrategyId);
}

export function updateVariantStatus(id: string, status: StrategyVariant['status'], performance?: Record<string, unknown>) {
  const variant = variantsStore.find(v => v.id === id);
  if (variant) {
    variant.status = status;
    if (performance) variant.performance = performance as StrategyVariant['performance'];
  }
}

/**
 * Apply variant overrides on top of base config
 */
export function applyVariantConfig(baseConfig: Record<string, unknown>, variant: StrategyVariant): Record<string, unknown> {
  return {
    ...baseConfig,
    ...variant.configOverrides,
  };
}
