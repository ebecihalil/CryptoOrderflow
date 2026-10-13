import type { MarketSourceStatus } from '../types/market';

/** Surface progressive Binance results without polling faster for long-running
 * scans on other venues or increasing the exchange scan frequency. */
export function snapshotPollInterval(
  sources: ReadonlyArray<Pick<MarketSourceStatus, 'exchange' | 'status'>> = [],
): number {
  return sources.some(source => source.exchange === 'binance'
    && (source.status === 'connecting' || source.status === 'refreshing'))
    ? 5_000 : 30_000;
}
