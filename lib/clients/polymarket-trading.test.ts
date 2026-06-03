import { describe, expect, it } from 'vitest';
import {
  parsePolymarketOrderForRecon,
  parsePolymarketPostOrderResult,
} from '@/lib/clients/polymarket-trading';

describe('parsePolymarketPostOrderResult', () => {
  it('parses successful orderID', () => {
    const r = parsePolymarketPostOrderResult({
      success: true,
      orderID: '0xabcdef1234567890abcdef1234567890abcdef12',
      status: 'live',
      errorMsg: '',
    });
    expect(r.success).toBe(true);
    expect(r.orderId).toMatch(/^0x/);
  });

  it('treats string status 403 as failure', () => {
    const r = parsePolymarketPostOrderResult({
      success: true,
      status: '403',
      error: 'Trading restricted in your region',
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('restricted');
  });

  it('fails on success with errorMsg and no order id', () => {
    const r = parsePolymarketPostOrderResult({
      success: true,
      errorMsg: 'ORDER_MIN_SIZE',
      orderID: '',
      status: '',
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('MIN_SIZE');
  });
});

describe('parsePolymarketOrderForRecon', () => {
  it('detects fully matched orders', () => {
    const recon = parsePolymarketOrderForRecon({
      orderID: 'ord-1',
      status: 'MATCHED',
      size_matched: '10',
      original_size: '10',
      price: '0.55',
    });
    expect(recon?.status).toBe('filled');
    expect(recon?.filledSize).toBe(10);
    expect(recon?.avgPrice).toBeCloseTo(0.55);
  });

  it('detects cancelled orders', () => {
    const recon = parsePolymarketOrderForRecon({
      orderID: 'ord-2',
      status: 'CANCELED',
      size_matched: '0',
      original_size: '5',
      price: '0.40',
    });
    expect(recon?.status).toBe('cancelled');
  });

  it('detects live open orders', () => {
    const recon = parsePolymarketOrderForRecon({
      orderID: 'ord-3',
      status: 'LIVE',
      size_matched: '2',
      original_size: '10',
      price: '0.48',
    });
    expect(recon?.status).toBe('open');
    expect(recon?.filledSize).toBe(2);
  });
});
