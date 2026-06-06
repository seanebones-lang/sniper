import { describe, it, expect } from 'vitest';
import { parseBtcWindowMinutes, isBtcUpDownMarket } from './btc-sniper';

describe('parseBtcWindowMinutes', () => {
  it('parses 5m window', () => {
    expect(parseBtcWindowMinutes('Bitcoin Up or Down - June 5, 11:05PM-11:10PM ET')).toBe(5);
  });

  it('parses 15m window', () => {
    expect(parseBtcWindowMinutes('Bitcoin Up or Down - June 5, 11:00PM-11:15PM ET')).toBe(15);
  });

  it('excludes daily markets', () => {
    expect(parseBtcWindowMinutes('Bitcoin Up or Down on June 6?')).toBeNull();
  });

  it('excludes 4h blocks', () => {
    expect(parseBtcWindowMinutes('Bitcoin Up or Down - June 5, 8:00PM-12:00AM ET')).toBeNull();
  });
});

describe('isBtcUpDownMarket', () => {
  it('accepts slug-tagged 5m market', () => {
    expect(
      isBtcUpDownMarket({
        question: 'Bitcoin Up or Down - June 5, 11:05PM-11:10PM ET',
        btcWindowMinutes: 5,
      }),
    ).toBe(true);
  });
});
