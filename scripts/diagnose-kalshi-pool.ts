import { fetchKalshiMarketsClosingWithinHours } from '../lib/clients/kalshi';
import { getAllMarkets, getMarketsForQuickFlip } from '../lib/markets';
import { filterQuickFlipMarkets } from '../lib/markets/fast-moving';
import { fetchKalshiOrderBook } from '../lib/clients/kalshi';

async function main() {
  const [kalshiNear, all, qf] = await Promise.all([
    fetchKalshiMarketsClosingWithinHours(3, 100),
    getAllMarkets(true),
    getMarketsForQuickFlip(true),
  ]);

  const kAll = all.filter((m) => m.platform === 'kalshi');
  const kQf = qf.filter((m) => m.platform === 'kalshi');
  const kEligible = filterQuickFlipMarkets(kalshiNear);

  console.log('Kalshi near-term (≤3h close):', kalshiNear.length);
  console.log('Kalshi in getAllMarkets:', kAll.length);
  console.log('Kalshi in quick-flip pool:', kQf.length);
  console.log('Kalshi eligible ≤3h:', kEligible.length);

  if (kalshiNear[0]) {
    const book = await fetchKalshiOrderBook(kalshiNear[0].externalId);
    console.log('\nSample market:', kalshiNear[0].question.slice(0, 60));
    console.log('  endDate:', kalshiNear[0].endDate);
    console.log('  book bids:', book.bids.length, 'asks:', book.asks.length);
    console.log('  top bid:', book.bids[0]?.price, 'top ask:', book.asks[0]?.price);
  }
}

main().catch(console.error);
