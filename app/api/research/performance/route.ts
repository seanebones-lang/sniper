import { NextResponse } from 'next/server';
import { getStrategyPerformance } from '@/lib/research/performance';

export async function GET() {
  const perf = await getStrategyPerformance(7);
  return NextResponse.json(perf);
}
