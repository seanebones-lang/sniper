import { NextResponse } from 'next/server';
import { askGrokResearchAgent } from '@/lib/research/grok-agent';
import { saveProposals } from '@/lib/research/proposals';

export async function POST(req: Request) {
  if (!process.env.XAI_API_KEY) {
    return NextResponse.json({ error: 'XAI_API_KEY not configured' }, { status: 400 });
  }

  const body = await req.json();

  try {
    const result = await askGrokResearchAgent(body);

    // Automatically persist any structured proposals for review
    if (result.proposals && result.proposals.length > 0) {
      await saveProposals((result.proposals || []) as unknown as Record<string, unknown>[], result.query as unknown as Record<string, unknown>);
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
