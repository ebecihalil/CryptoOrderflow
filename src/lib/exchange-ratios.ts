import type { LsarExchangeReading, MarketExchange } from '../types/market';

export function exchangeAccountRatio(readings: readonly LsarExchangeReading[], exchange: MarketExchange): number | null {
  const usable = readings.filter((reading) => reading.exchange === exchange
    && typeof reading.longShortRatio === 'number' && Number.isFinite(reading.longShortRatio) && reading.longShortRatio > 0
    && Number.isFinite(reading.openInterestUsd) && reading.openInterestUsd > 0);
  if (!usable.length) return null;
  const largestWeight = Math.max(...usable.map((reading) => reading.openInterestUsd));
  let weighted = 0;
  let weight = 0;
  for (const reading of usable) {
    const normalizedWeight = reading.openInterestUsd / largestWeight;
    weighted += reading.longShortRatio! * normalizedWeight;
    weight += normalizedWeight;
  }
  const ratio = weighted / weight;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}
