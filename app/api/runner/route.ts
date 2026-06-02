import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { startRunner, stopRunner, getRunnerStatus, getRunnerIntervalMs } from '@/lib/runner/engine';
import { getPaperPortfolio, applyPaperBudgetToRiskManager } from '@/lib/paper/portfolio';

async function runnerPayload() {
  const status = getRunnerStatus();
  const portfolio = await getPaperPortfolio(1);
  return {
    ...status,
    dbPaperFillsTotal: portfolio.runner.dbPaperFillsTotal,
    dbPaperFillsToday: portfolio.runner.dbPaperFillsToday,
    activeStrategies: portfolio.runner.activeStrategies,
    lastRunAgeSeconds: status.lastRun
      ? Math.round((Date.now() - new Date(status.lastRun).getTime()) / 1000)
      : null,
    pnl: portfolio.pnl,
  };
}

export async function POST(req: Request) {
  try {
    const { action } = await req.json();

    if (action === 'start') {
      const intervalMs = await getRunnerIntervalMs();
      await startRunner(intervalMs);
      return NextResponse.json({ status: 'started', intervalMs, ...await runnerPayload() });
    }

    if (action === 'stop') {
      stopRunner();
      return NextResponse.json({ status: 'stopped', ...await runnerPayload() });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    console.error('[api/runner POST]', err);
    return NextResponse.json(
      { error: getErrorMessage(err) || 'Runner action failed', running: false },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    return NextResponse.json(await runnerPayload());
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
