import { NextResponse } from 'next/server';
import { startRunner, stopRunner, getRunnerStatus } from '@/lib/runner/engine';

export async function POST(req: Request) {
  const { action } = await req.json();

  if (action === 'start') {
    await startRunner(12000); // every 12 seconds
    return NextResponse.json({ status: 'started' });
  }

  if (action === 'stop') {
    stopRunner();
    return NextResponse.json({ status: 'stopped' });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function GET() {
  return NextResponse.json(getRunnerStatus());
}
