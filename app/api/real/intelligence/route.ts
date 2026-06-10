import { NextResponse } from 'next/server';
import {
  getLiveFilterOverrides,
  loadLiveIntelligenceState,
  saveLiveIntelligenceState,
  clearTokenCooldown,
} from '@/lib/monitoring/live-intelligence';
import { getLiveGateStats } from '@/lib/monitoring/live-gate-stats';
import { getErrorMessage } from '@/lib/error-message';
import { requireApiAuth } from '@/lib/api-auth';

export async function GET() {
  try {
  const [state, filters, gateStats] = await Promise.all([
    loadLiveIntelligenceState(),
    getLiveFilterOverrides(),
    getLiveGateStats(),
  ]);

  return NextResponse.json({ state, filters, gateStats });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const authErr = requireApiAuth(req);
  if (authErr) return authErr;

  try {
  const body = (await req.json()) as {
    minMarketScore?: number;
    maxSpreadPct?: number;
    minEdgeAfterSpreadPct?: number;
    allowedKinds?: string[] | null;
    blockedKinds?: string[];
    clearTokenCooldown?: string;
    clearEntriesPaused?: boolean;
    entriesPaused?: boolean;
    resetFilters?: boolean;
  };

  if (body.clearTokenCooldown) {
    await clearTokenCooldown(body.clearTokenCooldown);
    return NextResponse.json({ ok: true, cleared: body.clearTokenCooldown });
  }

  if (body.clearEntriesPaused || body.entriesPaused === false) {
    await saveLiveIntelligenceState(
      { entriesPaused: false, entriesPausedReason: undefined },
      'manual entries resume via API',
    );
    return NextResponse.json({ ok: true, entriesPaused: false });
  }

  if (body.resetFilters) {
    await saveLiveIntelligenceState(
      {
        minMarketScore: undefined,
        maxSpreadPct: undefined,
        minEdgeAfterSpreadPct: undefined,
        allowedKinds: null,
        blockedKinds: ['short-crypto'],
        entriesPaused: false,
        entriesPausedReason: undefined,
      },
      'manual reset via API',
    );
    return NextResponse.json({ ok: true, reset: true });
  }

  const patch: Record<string, unknown> = {};
  if (body.minMarketScore != null) patch.minMarketScore = body.minMarketScore;
  if (body.maxSpreadPct != null) patch.maxSpreadPct = body.maxSpreadPct;
  if (body.minEdgeAfterSpreadPct != null) patch.minEdgeAfterSpreadPct = body.minEdgeAfterSpreadPct;
  if (body.allowedKinds !== undefined) patch.allowedKinds = body.allowedKinds;
  if (body.blockedKinds != null) patch.blockedKinds = body.blockedKinds;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No patch fields' }, { status: 400 });
  }

  const next = await saveLiveIntelligenceState(patch, 'API patch');
  return NextResponse.json({ ok: true, state: next });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
