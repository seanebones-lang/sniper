import type { AIRecommendation } from '@/lib/monitoring/ai-recommendations';
import type { RiskMode } from '@/lib/monitoring/risk-mode';
import type { TemporaryAdjustment } from '@/lib/monitoring/temporary-adjustments';
import type { StrategyVariant } from '@/lib/strategies/variants';

export interface HealthResponse {
  timestamp: string;
  recentPerformance: Record<string, unknown>;
  activeVariants: StrategyVariant[];
  risk: {
    mode: RiskMode;
    reason: string;
    enteredAt?: string;
    riskMultiplier: number;
    behavioralRestrictions?: Record<string, unknown>;
  };
  execution: {
    systemHealthScore: number;
    recentFills: number;
    averageSlippage: number;
    unhealthyMarkets: string[];
    lastFills?: unknown[];
  };
  aiRecommendations: Array<AIRecommendation & { index: number }>;
  temporaryAdjustments: {
    active: TemporaryAdjustment[];
    summary: string;
  };
  summary: {
    totalActiveStrategies: number;
    totalVariants: number;
    marketsWithPoorExecution?: number;
  };
}
