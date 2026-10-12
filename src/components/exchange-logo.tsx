import type { MarketExchange } from '@/types/market';

const LOGOS: Record<MarketExchange, string> = {
  binance: '/exchanges/binance.jpg',
  bybit: '/exchanges/bybit.png',
  okx: '/exchanges/okx.png',
  gate: '/exchanges/gate.png',
  bitget: '/exchanges/bitget.jpg',
  toobit: '/exchanges/toobit.png',
};

export function ExchangeLogo({ exchange }: { exchange: MarketExchange }) {
  return <img className="exchange-logo" src={LOGOS[exchange]} alt="" aria-hidden="true" width={16} height={16} />;
}
