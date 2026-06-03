import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { startRunner, stopRunner, getRunnerStatus, getRunnerIntervalMs } from '@/lib/runner/engine';
import { isRealExecutionAllowed } from '@/lib/execution/real-executor';
import { db, paperTrades, strategies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { gte, count, and } from 'drizzle-orm';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';
import { getPaperPortfolio } from '@/lib/paper/portfolio';

async function cheapRunnerCounts() {
  const runStart = await getPaperRunStartedAt();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const runFilter = runStart ? gte(paperTrades.filledAt, runStart) : undefined;

  const [totalCountRow, todayCountRow, stratRows] = await Promise.all([
    db.select({ count: count() }).from(paperTrades).where(runFilter),
    db.select({ count: count() }).from(paperTrades).where(
      runStart
        ? and(gte(paperTrades.filledAt, todayStart), runFilter)
        : gte(paperTrades.filledAt, todayStart),
    ),
    db.query.strategies.findMany({ columns: { id: true, isActive: true } }),
  ]);

  return {
    dbPaperFillsTotal: totalCountRow[0]?.count ?? 0,
    dbPaperFillsToday: todayCountRow[0]?.count ?? 0,
    activeStrategies: stratRows.filter((s) => s.isActive).length,
  };
}

async function getRunnerExecutionMode(): Promise<'paper' | 'live' | 'mixed'> {
  const active = await db.query.strategies.findMany({
    where: eq(strategies.isActive, true),
    columns: { paperOnly: true },
  });
  const realAllowed = await isRealExecutionAllowed();
  const liveCount = active.filter((s) => !s.paperOnly).length;
  if (!realAllowed || liveCount === 0) return 'paper';
  if (liveCount >= active.length) return 'live';
  return 'mixed';
}

async function runnerPayload(includePnl: boolean) {
  const status = getRunnerStatus();
  const counts = await cheapRunnerCounts();
  const executionMode = await getRunnerExecutionMode();

  const payload: Record<string, unknown> = {
    ...status,
    ...counts,
    executionMode,
    realExecutionEnabled: process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true',
    lastRunAgeSeconds: status.lastRun
      ? Math.round((Date.now() - new Date(status.lastRun).getTime()) / 1000)
      : null,
  };

  if (includePnl) {
    const portfolio = await getPaperPortfolio(1);
    payload.pnl = portfolio.pnl;
  }

  return payload;
}

export async function POST(req: Request) {
  try {
    const { action } = await req.json();

    if (action === 'start') {
      const intervalMs = await getRunnerIntervalMs();
      await startRunner(intervalMs);
      return NextResponse.json({ status: 'started', intervalMs, ...(await runnerPayload(false)) });
    }

    if (action === 'stop') {
      stopRunner();
      return NextResponse.json({ status: 'stopped', ...(await runnerPayload(false)) });
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

export async function GET(req: Request) {
  try {
    const includePnl = new URL(req.url).searchParams.get('includePnl') === '1';
    return NextResponse.json(await runnerPayload(includePnl));
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
