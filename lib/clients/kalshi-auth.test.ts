import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import { createKalshiWsAuthHeaders, signKalshiRequest } from '@/lib/clients/kalshi-auth';

function generateTestKeyPair(): { publicKey: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKeyPem: privateKey };
}

describe('kalshi-auth', () => {
  it('signs WebSocket handshake path', () => {
    const { privateKeyPem } = generateTestKeyPair();
    const timestamp = '1700000000000';
    const sig = signKalshiRequest(privateKeyPem, timestamp, 'GET', '/trade-api/ws/v2');
    expect(sig.length).toBeGreaterThan(20);

    const headers = createKalshiWsAuthHeaders({
      accessKey: 'test-key-id',
      privateKeyPem,
    });
    expect(headers['KALSHI-ACCESS-KEY']).toBe('test-key-id');
    expect(headers['KALSHI-ACCESS-TIMESTAMP']).toMatch(/^\d+$/);
    expect(headers['KALSHI-ACCESS-SIGNATURE']).toBeTruthy();
  });
});
