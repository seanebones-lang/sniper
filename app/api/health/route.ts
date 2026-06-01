import { NextResponse } from 'next/server';
import { getStrategyPerformance } from '@/lib/research/performance';
import { getAllVariants } from '@/lib/strategies/variants';
import { executionManager } from '@/lib/execution/execution-manager';

export async function GET() {
  const performance = await getStrategyPerformance(3);
  const variants = getAllVariants();
  const execQuality = executionManager.getRecentExecutionQuality(30);
  const avgSlippage = executionManager.getAverageSlippage(50);

  const health = {
    timestamp: new Date().toISOString(),
    recentPerformance: performance,
    activeVariants: variants.filter(v => v.status === 'testing' || v.status === 'promoted'),
    execution: {
      recentFills: execQuality.length,
      averageSlippage: parseFloat(avgSlippage.toFixed(5)),
      lastFills: execQuality.slice(-5),
    },
    summary: {
      totalActiveStrategies: Object.keys(performance.byStrategy || {}).length,
      totalVariants: variants.length,
    },
  };

  return NextResponse.json(health);
}
