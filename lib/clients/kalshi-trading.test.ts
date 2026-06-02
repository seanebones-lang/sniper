import { describe, it, expect } from 'vitest';

// We can't easily test the real authenticated flow without keys, so we test the client class structure and error cases.

import { getKalshiTradingClient, KalshiTradingClient } from './kalshi-trading';

describe('KalshiTradingClient', () => {
  it('should throw when no credentials are provided and env vars are missing', () => {
    // Temporarily clear env
    const originalAccess = process.env.KALSHI_ACCESS_KEY;
    const originalKey = process.env.KALSHI_RSA_PRIVATE_KEY;

    delete process.env.KALSHI_ACCESS_KEY;
    delete process.env.KALSHI_RSA_PRIVATE_KEY;

    expect(() => {
      getKalshiTradingClient();
    }).toThrow(/Kalshi trading credentials not found/);

    // Restore
    if (originalAccess) process.env.KALSHI_ACCESS_KEY = originalAccess;
    if (originalKey) process.env.KALSHI_RSA_PRIVATE_KEY = originalKey;
  });

  it('should expose placeOrder method', () => {
    // We can construct with dummy creds for structure test
    const dummyCreds = {
      accessKey: 'test-key',
      privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    };

    const client = new KalshiTradingClient(dummyCreds);
    expect(typeof client.placeOrder).toBe('function');
    expect(typeof client.getBalance).toBe('function');
  });

  it('should expose new reconciliation methods (getOrder, getOrders, getFills, getOrderStatus)', () => {
    const dummyCreds = {
      accessKey: 'test-key',
      privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    };

    const client = new KalshiTradingClient(dummyCreds);
    expect(typeof client.getOrder).toBe('function');
    expect(typeof client.getOrders).toBe('function');
    expect(typeof client.getFills).toBe('function');
    expect(typeof client.getOrderStatus).toBe('function');
  });
});
