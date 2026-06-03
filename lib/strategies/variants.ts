/**
 * Strategy Variants System — persisted to system_state for restart survival.
 */
import type { StrategyProposal } from '@/lib/research/grok-agent';
import type { StrategyConfig } from '@/lib/strategies/types';
import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';

export interface StrategyVariant {
  id: string;
  baseStrategyId: string;
  name: string;
  description: string;
  configOverrides: Record<string, unknown>;
  source: 'grok_proposal' | 'manual';
  status: 'proposed' | 'testing' | 'promoted' | 'rejected';
  createdAt: string;
  performance?: {
    replayPnl: number;
    trades: number;
    winRate: number;
    maxDD: number;
  };
}

const VARIANTS_KEY = 'strategy_variants' as const;
let variantsCache: StrategyVariant[] | null = null;

async function loadVariantsFromDb(): Promise<StrategyVariant[]> {
  if (variantsCache) return variantsCache;
  const row = await loadSystemState<StrategyVariant[]>(VARIANTS_KEY);
  variantsCache = row ?? [];
  return variantsCache;
}

async function saveVariants(variants: StrategyVariant[]): Promise<void> {
  variantsCache = variants;
  await persistSystemState(VARIANTS_KEY, variants, 'strategy variants updated');
}

export async function createVariantFromProposal(proposal: StrategyProposal): Promise<StrategyVariant> {
  const variants = await loadVariantsFromDb();
  const variant: StrategyVariant = {
    id: `variant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    baseStrategyId: proposal.strategyId,
    name: `${proposal.strategyId} - ${proposal.type} variant`,
    description: proposal.description,
    configOverrides: proposal.suggestedChange,
    source: 'grok_proposal',
    status: 'proposed',
    createdAt: new Date().toISOString(),
  };
  variants.push(variant);
  await saveVariants(variants);
  return variant;
}

export async function getAllVariants(): Promise<StrategyVariant[]> {
  return [...(await loadVariantsFromDb())];
}

export async function getVariantsForStrategy(baseStrategyId: string): Promise<StrategyVariant[]> {
  return (await loadVariantsFromDb()).filter((v) => v.baseStrategyId === baseStrategyId);
}

export async function updateVariantStatus(
  id: string,
  status: StrategyVariant['status'],
  performance?: StrategyVariant['performance'],
) {
  const variants = await loadVariantsFromDb();
  const variant = variants.find((v) => v.id === id);
  if (variant) {
    variant.status = status;
    if (performance) variant.performance = performance;
    await saveVariants(variants);
  }
}

export function applyVariantConfig(
  baseConfig: StrategyConfig,
  variant: StrategyVariant,
): StrategyConfig {
  return {
    ...baseConfig,
    ...variant.configOverrides,
  } as StrategyConfig;
}

/** Sync load for legacy sync callers — returns cache or empty until hydrated. */
export function getAllVariantsSync(): StrategyVariant[] {
  return variantsCache ? [...variantsCache] : [];
}

void loadVariantsFromDb().catch(() => {});
