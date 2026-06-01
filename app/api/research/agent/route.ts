import { NextResponse } from 'next/server';
import { askGrokResearchAgent } from '@/lib/research/grok-agent';

export async function POST(req: Request) {
  if (!process.env.XAI_API_KEY) {
    return NextResponse.json({ error: 'XAI_API_KEY not configured' }, { status: 400 });
  }

  const body = await req.json();

  try {
    const result = await askGrokResearchAgent(body);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
