import type { MarketExchange } from '../types/market';

export const MARKET_EXCHANGES: MarketExchange[] = ['binance', 'bybit', 'okx', 'gate', 'bitget'];

export const EXCHANGE_LABELS: Record<MarketExchange, string> = {
  binance: 'Binance',
  bybit: 'Bybit',
  okx: 'OKX',
  gate: 'Gate.io',
  bitget: 'Bitget',
};

export function matchesExchangeFilter(
  exchanges: readonly MarketExchange[],
  selected: readonly MarketExchange[],
  multipleOnly = false,
) {
  return (!multipleOnly || exchanges.length > 1) && exchanges.some((exchange) => selected.includes(exchange));
}
