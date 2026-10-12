import type { LsarInstrument, LsarTimeframe, MarketExchange } from '../types/market';
import { exchangeAccountRatio } from './exchange-ratios.ts';

export type MarketSortMode = 'increase' | 'decrease' | 'absolute';
export type MarketSortTarget = 'change' | 'current' | MarketExchange;
type SortableMarketRow = Pick<LsarInstrument, 'asset' | 'currentRatio' | 'changes' | 'exchangeReadings'>;

export function nextHeaderSortMode(active: boolean, mode: MarketSortMode): MarketSortMode {
  return active && mode === 'increase' ? 'decrease' : 'increase';
}

export function compareMarketRows(
  a: SortableMarketRow,
  b: SortableMarketRow,
  timeframe: LsarTimeframe,
  mode: MarketSortMode,
  target: MarketSortTarget,
) {
  const value = (row: SortableMarketRow) => {
    const result = target === 'current' ? row.currentRatio
      : target === 'change' ? row.changes.find((change) => change.timeframe === timeframe)?.ratioChangePct ?? null
      : exchangeAccountRatio(row.exchangeReadings, target);
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  };
  const aValue = value(a);
  const bValue = value(b);
  if (aValue === null && bValue === null) return a.asset.localeCompare(b.asset);
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  const difference = mode === 'decrease' ? aValue - bValue
    : mode === 'absolute' ? Math.abs(bValue) - Math.abs(aValue)
    : bValue - aValue;
  return difference || a.asset.localeCompare(b.asset);
}
