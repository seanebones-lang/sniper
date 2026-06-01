import { NextResponse } from 'next/server';
import { getStrategyPerformance } from '@/lib/research/performance';
import { getAllVariants } from '@/lib/strategies/variants';

export async function GET() {
  const performance = await getStrategyPerformance(3);
  const variants = getAllVariants();

  // In a real system we would also fetch current runner regime, recent signals, etc.
  const health = {
    timestamp: new Date().toISOString(),
    recentPerformance: performance,
    activeVariants: variants.filter(v => v.status === 'testing' || v.status === 'promoted'),
    summary: {
      totalActiveStrategies: Object.keys(performance.byStrategy || {}).length,
      totalVariants: variants.length,
    },
  };

  return NextResponse.json(health);
}
