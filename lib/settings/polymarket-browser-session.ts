import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';
import { clearPolymarketHttpMiddlewareCache } from '@/lib/clients/polymarket-http-proxy';

export interface PolymarketBrowserSession {
  cfClearance: string;
  userAgent: string;
  updatedAt: string;
}

export async function getPolymarketBrowserSessionFromDb(): Promise<PolymarketBrowserSession | null> {
  const row = await loadSystemState<PolymarketBrowserSession>('polymarket_browser_session');
  if (!row?.cfClearance?.trim() || !row?.userAgent?.trim()) return null;
  return row;
}

export async function setPolymarketBrowserSession(
  cfClearance: string,
  userAgent: string,
): Promise<void> {
  const session: PolymarketBrowserSession = {
    cfClearance: cfClearance.trim(),
    userAgent: userAgent.trim(),
    updatedAt: new Date().toISOString(),
  };
  if (!session.cfClearance || !session.userAgent) {
    throw new Error('cfClearance and userAgent are required');
  }
  await persistSystemState('polymarket_browser_session', session, 'browser session for CLOB WAF');
  clearPolymarketHttpMiddlewareCache();
}

export async function clearPolymarketBrowserSession(): Promise<void> {
  await persistSystemState('polymarket_browser_session', {
    cfClearance: '',
    userAgent: '',
    updatedAt: new Date().toISOString(),
  });
  clearPolymarketHttpMiddlewareCache();
}
