import { describe, it, expect, afterAll } from 'vitest';

import {
  setPolymarketProxyEgressEnabled,
  isPolymarketProxyEgressEnabled,
  getClobAxiosAgents,
  getPolymarketFetchInit,
} from './polymarket-http-proxy';

describe('polymarket proxy egress gating', () => {
  afterAll(() => setPolymarketProxyEgressEnabled(true)); // restore default for other suites

  it('defaults to enabled (live behavior unchanged)', () => {
    expect(isPolymarketProxyEgressEnabled()).toBe(true);
  });

  it('disabling drops proxy agents and the fetch dispatcher (direct egress)', async () => {
    setPolymarketProxyEgressEnabled(false);
    expect(isPolymarketProxyEgressEnabled()).toBe(false);

    const agents = getClobAxiosAgents();
    expect(agents.httpsAgent).toBeUndefined();
    expect(agents.httpAgent).toBeUndefined();
    expect(agents.proxy).toBe(false);

    // Disabled path returns early before any DB/proxy resolution.
    const init = await getPolymarketFetchInit();
    expect((init as { dispatcher?: unknown }).dispatcher).toBeUndefined();
    expect(Object.keys(init)).toHaveLength(0);
  });

  it('re-enabling flips the flag back', () => {
    setPolymarketProxyEgressEnabled(true);
    expect(isPolymarketProxyEgressEnabled()).toBe(true);
  });
});
