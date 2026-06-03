import { NextResponse } from 'next/server';

/**
 * Liveness probe for the deploy platform (Railway healthcheck).
 *
 * Intentionally trivial: it does NO database or analytics work so it returns
 * 200 the instant the Node process is accepting connections. Heavy status data
 * lives at /api/health (used by the dashboard) — that route must never gate a
 * deploy, because slow analytics over a large table would time out the probe.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    ok: true,
    deployMarker: 'liveness-v1',
    timestamp: new Date().toISOString(),
  });
}
