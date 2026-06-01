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
  configOverrides: Record<string, any>;
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

export function createVariantFromProposal(proposal: any): StrategyVariant {
  const variant: StrategyVariant = {
    id: `variant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    baseStrategyId: proposal.strategyId,
    name: `${proposal.strategyId} - ${proposal.type} variant`,
    description: proposal.description,
    configOverrides: proposal.suggestedChange,
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

export function updateVariantStatus(id: string, status: StrategyVariant['status'], performance?: any) {
  const variant = variantsStore.find(v => v.id === id);
  if (variant) {
    variant.status = status;
    if (performance) variant.performance = performance;
  }
}

/**
 * Apply variant overrides on top of base config
 */
export function applyVariantConfig(baseConfig: any, variant: StrategyVariant): any {
  return {
    ...baseConfig,
    ...variant.configOverrides,
  };
}
