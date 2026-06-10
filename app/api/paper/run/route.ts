import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import { startNewPaperRun } from '@/lib/paper/run-session';
import { getPaperPortfolio, applyPaperBudgetToRiskManager } from '@/lib/paper/portfolio';

const bodySchema = z.object({
  action: z.literal('new'),
});

export async function POST(req: Request) {
  const authErr = requireApiAuth(req);
  if (authErr) return authErr;

  try {
    const body = bodySchema.parse(await req.json());
    if (body.action !== 'new') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const session = await startNewPaperRun();
    await applyPaperBudgetToRiskManager();
    const portfolio = await getPaperPortfolio();

    return NextResponse.json({
      ok: true,
      runSession: session,
      portfolio,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) || 'Invalid request' }, { status: 400 });
  }
}
