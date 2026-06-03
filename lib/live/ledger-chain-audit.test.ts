import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/execution/real-positions', () => ({
  getRealOpenPositionsByStrategy: vi.fn().mockResolvedValue(
    new Map([
      [
        'strat-1',
        [
          {
            platform: 'polymarket',
            marketExternalId: 'ghost-token',
            netSize: 1000,
            avgEntryPrice: 0.001,
            openedAt: new Date(),
          },
          {
            platform: 'polymarket',
            marketExternalId: 'real-token',
            netSize: 100,
            avgEntryPrice: 0.05,
            openedAt: new Date(),
          },
        ],
      ],
    ]),
  ),
}));

vi.mock('@/lib/clients/polymarket-trading', () => ({
  getPolymarketPrivateKey: vi.fn().mockReturnValue('0xabc'),
  getPolymarketTokenBalance: vi.fn().mockImplementation((_pk: string, token: string) => {
    if (token === 'ghost-token') return Promise.resolve(0);
    if (token === 'real-token') return Promise.resolve(98);
    return Promise.resolve(0);
  }),
}));

describe('auditLedgerVsChain', () => {
  it('flags ghost positions when chain balance is zero', async () => {
    const { auditLedgerVsChain } = await import('./ledger-chain-audit');
    const result = await auditLedgerVsChain(['strat-1']);
    expect(result.ghosts).toHaveLength(1);
    expect(result.ghosts[0].marketExternalId).toBe('ghost-token');
  });
});
