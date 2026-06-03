import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { getLiveOpsSnapshot } from '@/lib/live/ops-snapshot';

export async function GET() {
  try {
    return NextResponse.json(await getLiveOpsSnapshot());
  } catch (err: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(err) || 'Failed to load live ops' },
      { status: 500 },
    );
  }
}
