import { NextResponse } from 'next/server';
import { applyRecommendation, ignoreRecommendation } from '@/lib/monitoring/ai-recommendations';

export async function POST(req: Request) {
  const body = await req.json();
  const { index, action = 'apply', outcomeNote } = body;

  if (typeof index !== 'number') {
    return NextResponse.json({ error: 'index (number) is required' }, { status: 400 });
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
