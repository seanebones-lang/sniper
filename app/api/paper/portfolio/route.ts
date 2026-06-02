import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { z } from 'zod';
import { getPaperPortfolio, applyPaperBudgetToRiskManager } from '@/lib/paper/portfolio';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.min(30, Math.max(1, parseInt(searchParams.get('days') ?? '7', 10) || 7));
    const portfolio = await getPaperPortfolio(days);
    return NextResponse.json(portfolio, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err: unknown) {
    console.error('[api/paper/portfolio]', err);
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

const patchSchema = z.object({
  paperBudgetUsd: z.number().min(100).max(1_000_000).optional(),
  maxExposureUsd: z.number().min(50).max(1_000_000).optional(),
  maxDailyLossUsd: z.number().min(10).max(100_000).optional(),
});

export async function PATCH(req: Request) {
  try {
    const body = patchSchema.parse(await req.json());
    const { setPaperBudgetSettings } = await import('@/lib/settings/paper-budget');
    const budget = await setPaperBudgetSettings(body);
    await applyPaperBudgetToRiskManager();
    const portfolio = await getPaperPortfolio();
    return NextResponse.json({ budget, runner: portfolio.runner });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) || 'Invalid request' }, { status: 400 });
  }
}
