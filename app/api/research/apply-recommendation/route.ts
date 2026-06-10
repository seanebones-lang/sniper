import { NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { applyRecommendation, ignoreRecommendation } from '@/lib/monitoring/ai-recommendations';

export async function POST(req: Request) {
  const authErr = requireApiAuth(req);
  if (authErr) return authErr;

  const body = (await req.json().catch(() => null)) as {
    index?: unknown;
    action?: string;
    outcomeNote?: string;
  } | null;
  const { index, action = 'apply', outcomeNote } = body ?? {};

  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: 'index (non-negative integer) is required' }, { status: 400 });
  }

  let success = false;

  if (action === 'apply') {
    success = applyRecommendation(index, outcomeNote);
  } else if (action === 'ignore') {
    success = ignoreRecommendation(index, outcomeNote);
  } else if (action === 'auto_apply') {
    success = applyRecommendation(index, outcomeNote, true);
  }

  if (!success) {
    return NextResponse.json({ error: 'Failed to update recommendation (already acted on or invalid index)' }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
