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
      await saveProposals(result.proposals, result.query);
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
