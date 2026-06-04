import { describe, expect, it } from 'vitest';
import { normalizeProxyUrl, parseProxyList } from '@/lib/clients/mars-proxy';

describe('normalizeProxyUrl', () => {
  it('converts Mars host:port:user:pass to http URL', () => {
    expect(
      normalizeProxyUrl('ultra.marsproxies.com:44443:mr135825SysQ:MfU3seWFup_country-ie'),
    ).toBe('http://mr135825SysQ:MfU3seWFup_country-ie@ultra.marsproxies.com:44443');
  });

  it('passes through http URLs', () => {
    const url = 'http://user:pass@host:44443';
    expect(normalizeProxyUrl(url)).toBe(url);
  });
});

describe('parseProxyList', () => {
  it('dedupes identical Mars lines', () => {
    const raw = [
      'ultra.marsproxies.com:44443:user:pass_country-ie',
      'ultra.marsproxies.com:44443:user:pass_country-ie',
    ].join('\n');
    expect(parseProxyList(raw)).toHaveLength(1);
  });
});
