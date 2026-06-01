import { NextResponse } from 'next/server';
import { getRecentProposals } from '@/lib/research/proposals';

export async function GET() {
  const proposals = await getRecentProposals(30);
  return NextResponse.json({ proposals });
}
