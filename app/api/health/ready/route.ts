import { NextResponse } from 'next/server';
import { computeReadiness } from '@/lib/monitoring/readiness';

export async function GET() {
  const result = await computeReadiness();
  return NextResponse.json(
    {
      ...result,
      timestamp: new Date().toISOString(),
    },
    { status: result.ready ? 200 : 503 },
  );
}
