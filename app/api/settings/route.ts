import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import {
  clearXaiApiKey,
  getSettingsStatus,
  setGrokResearchEnabled,
  setXaiApiKey,
} from '@/lib/settings/keys';

export async function GET() {
  const status = await getSettingsStatus();
  return NextResponse.json(status);
}

const postSchema = z.object({
  xaiApiKey: z.string().min(10).optional(),
  enableGrokResearchAgent: z.boolean().optional(),
  clearXaiApiKey: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const authErr = requireApiAuth(req);
    if (authErr) return authErr;

    const body = postSchema.parse(await req.json());
    const status = await getSettingsStatus();

    if (body.clearXaiApiKey) {
      if (!status.canEditXaiKey) {
        return NextResponse.json(
          { error: 'XAI_API_KEY is set in .env.local — remove it there to manage from Settings' },
          { status: 400 },
        );
      }
      await clearXaiApiKey();
    }

    if (body.xaiApiKey) {
      if (!status.canEditXaiKey) {
        return NextResponse.json(
          { error: 'XAI_API_KEY is set in .env.local — remove it there to manage from Settings' },
          { status: 400 },
        );
      }
      await setXaiApiKey(body.xaiApiKey);
    }

    if (body.enableGrokResearchAgent != null) {
      await setGrokResearchEnabled(body.enableGrokResearchAgent);
    }

    return NextResponse.json(await getSettingsStatus());
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) || 'Invalid request' }, { status: 400 });
  }
}
