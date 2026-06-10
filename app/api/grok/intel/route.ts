import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getErrorMessage } from '@/lib/error-message';
import { requireApiAuth } from '@/lib/api-auth';
import { generateText } from 'ai';
import { xai } from '@ai-sdk/xai';

const bodySchema = z.object({
  marketQuestion: z.string().min(1).max(2000),
  currentPrice: z.union([z.number(), z.string().max(40)]).optional(),
});

export async function POST(req: Request) {
  const authErr = requireApiAuth(req);
  if (authErr) return authErr;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { marketQuestion, currentPrice } = parsed.data;

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
