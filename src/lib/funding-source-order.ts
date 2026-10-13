import type { FundingSource } from '../types/funding';

const PRIORITY = ['binance', 'bybit', 'okx', 'gate'];

export function orderFundingSources(sources: readonly FundingSource[]): FundingSource[] {
  return [...sources].sort((left, right) => {
    const leftRank = PRIORITY.indexOf(left.exchange);
    const rightRank = PRIORITY.indexOf(right.exchange);
    if (leftRank >= 0 || rightRank >= 0) {
      return (leftRank < 0 ? PRIORITY.length : leftRank)
        - (rightRank < 0 ? PRIORITY.length : rightRank);
    }
    const leftOi = Number.isFinite(left.openInterestUsd) ? left.openInterestUsd : 0;
    const rightOi = Number.isFinite(right.openInterestUsd) ? right.openInterestUsd : 0;
    return rightOi - leftOi || left.exchange.localeCompare(right.exchange);
  });
}
