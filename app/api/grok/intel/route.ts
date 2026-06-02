import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { xai } from '@ai-sdk/xai';

export async function POST(req: Request) {
  const { marketQuestion, currentPrice } = await req.json();

  if (!process.env.XAI_API_KEY) {
    return NextResponse.json({ error: 'XAI_API_KEY not configured' }, { status: 400 });
  }

  try {
    const { text } = await generateText({
      model: xai('grok-4'),
      prompt: `You are a sharp prediction market analyst. Give a concise, non-hype analysis of this market:\n\nQuestion: ${marketQuestion}\nCurrent price: ${currentPrice}\n\nFocus on: key catalysts, risks, and whether the current price looks cheap/expensive on a 1-10 edge scale. Keep it under 180 words.`,
    });

    return NextResponse.json({ analysis: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
