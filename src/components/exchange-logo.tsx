const LOGOS: Record<string, string> = {
  binance: '/exchanges/binance.jpg',
  bybit: '/exchanges/bybit.png',
  okx: '/exchanges/okx.png',
  gate: '/exchanges/gate.png',
  bitget: '/exchanges/bitget.jpg',
  toobit: '/exchanges/toobit.png',
  mexc: '/exchanges/mexc.jpg',
  kucoin: '/exchanges/kucoin.png',
  kraken: '/exchanges/kraken.jpg',
  bingx: '/exchanges/bingx.jpg',
  hyperliquid: '/exchanges/hyperliquid.png',
  htx: '/exchanges/htx.png',
  deribit: '/exchanges/deribit.jpg',
  aster: '/exchanges/aster.png',
};

export function ExchangeLogo({ exchange }: { exchange: string }) {
  const source = LOGOS[exchange];
  if (!source) {
    return <span className="exchange-logo funding-exchange-fallback" aria-hidden="true">{exchange.slice(0, 2).toUpperCase()}</span>;
  }
  return <img className="exchange-logo" src={source} alt="" aria-hidden="true" width={16} height={16} />;
}
