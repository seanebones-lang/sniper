import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { requireApiAuth } from '@/lib/api-auth';
import { askGrokResearchAgent } from '@/lib/research/grok-agent';
import { saveProposals } from '@/lib/research/proposals';
import { getSettingsStatus } from '@/lib/settings/keys';

export async function POST(req: Request) {
  const authErr = requireApiAuth(req);
  if (authErr) return authErr;

  const status = await getSettingsStatus();
  if (!status.xaiConfigured) {
    return NextResponse.json(
      { error: 'XAI API key not configured. Add it in Settings (/settings).' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const result = await askGrokResearchAgent(body);

    // Automatically persist any structured proposals for review
    if (result.proposals && result.proposals.length > 0) {
      await saveProposals(result.proposals, result.query);
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
