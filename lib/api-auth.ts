import { createHash, timingSafeEqual } from 'crypto';

/**
 * Optional bearer-token auth for mutating API routes in production.
 * Set SNIPER_API_SECRET — when unset, auth is skipped (local dev).
 */
export function isApiAuthRequired(): boolean {
  return !!process.env.SNIPER_API_SECRET?.trim();
}

/** Constant-time comparison; SHA-256 normalizes length so no size info leaks. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function verifyApiAuth(req: Request): boolean {
  const secret = process.env.SNIPER_API_SECRET?.trim();
  if (!secret) return true;

  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ') && secretsMatch(auth.slice(7).trim(), secret)) {
    return true;
  }

  const header = req.headers.get('x-sniper-secret');
  if (header && secretsMatch(header.trim(), secret)) return true;

  return false;
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Use at top of mutating route handlers. */
export function requireApiAuth(req: Request): Response | null {
  if (!verifyApiAuth(req)) return unauthorizedResponse();
  return null;
}
