import type { MarketExchange } from '../types/market';

export const MARKET_EXCHANGES: MarketExchange[] = ['binance', 'bybit', 'okx', 'gate', 'bitget', 'toobit'];

export const EXCHANGE_LABELS: Record<MarketExchange, string> = {
  binance: 'Binance',
  bybit: 'Bybit',
  okx: 'OKX',
  gate: 'Gate.io',
  bitget: 'Bitget',
  toobit: 'Toobit',
};

export function selectExchanges(selected: readonly MarketExchange[]) {
  return { selected: [...selected], multipleOnly: false };
}

export function selectMultipleOnly(multipleOnly: boolean) {
  return { selected: [] as MarketExchange[], multipleOnly };
}

export function matchesExchangeFilter(
  exchanges: readonly MarketExchange[],
  selected: readonly MarketExchange[],
  multipleOnly = false,
) {
  if (multipleOnly) return new Set(exchanges).size > 1;
  return exchanges.some((exchange) => selected.includes(exchange));
}
