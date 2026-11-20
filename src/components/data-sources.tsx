import { useI18n } from '@/lib/i18n';
import '@/styles/data-sources.css';

/** Exchanges this site reads public market data from (prices, trades, funding, OI, ratios). */
export const DATA_SOURCES: Array<{ id: string; name: string; logo: string }> = [
  { id: 'binance', name: 'Binance', logo: '/exchanges/binance.jpg' },
  { id: 'bybit', name: 'Bybit', logo: '/exchanges/bybit.png' },
  { id: 'okx', name: 'OKX', logo: '/exchanges/okx.png' },
  { id: 'gate', name: 'Gate.io', logo: '/exchanges/gate.png' },
  { id: 'bitget', name: 'Bitget', logo: '/exchanges/bitget.jpg' },
  { id: 'mexc', name: 'MEXC', logo: '/exchanges/mexc.jpg' },
  { id: 'kucoin', name: 'KuCoin', logo: '/exchanges/kucoin.png' },
  { id: 'bingx', name: 'BingX', logo: '/exchanges/bingx.jpg' },
  { id: 'htx', name: 'HTX', logo: '/exchanges/htx.png' },
  { id: 'kraken', name: 'Kraken', logo: '/exchanges/kraken.jpg' },
  { id: 'hyperliquid', name: 'Hyperliquid', logo: '/exchanges/hyperliquid.png' },
  { id: 'aster', name: 'Aster', logo: '/exchanges/aster.png' },
  { id: 'lighter', name: 'Lighter', logo: '/exchanges/lighter.png' },
  { id: 'paradex', name: 'Paradex', logo: '/exchanges/paradex.png' },
  { id: 'deribit', name: 'Deribit', logo: '/exchanges/deribit.jpg' },
  { id: 'coinex', name: 'CoinEx', logo: '/exchanges/coinex.png' },
  { id: 'bitmex', name: 'BitMEX', logo: '/exchanges/bitmex.ico' },
  { id: 'toobit', name: 'Toobit', logo: '/exchanges/toobit.png' },
  { id: 'cme', name: 'CME Group', logo: '/exchanges/cme.png' },
];

export function DataSources() {
  const { t } = useI18n();
  return (
    <section className="data-sources" aria-labelledby="data-sources-title" data-testid="data-sources">
      <div className="directory-heading">
        <h2 id="data-sources-title">{t('Data sources used by Crypto Order Flow')}</h2>
        <span className="directory-count">{String(DATA_SOURCES.length).padStart(2, '0')} {t('EXCHANGES')}</span>
      </div>
      <ul className="data-sources-grid">
        {DATA_SOURCES.map((source) => (
          <li key={source.id} className="data-source" data-testid={`data-source-${source.id}`}>
            <span className={`data-source-logo${source.id === 'cme' ? ' is-wide' : ''}`}>
              <img src={source.logo} alt="" width={44} height={44} loading="lazy" decoding="async" draggable={false} />
            </span>
            <span className="data-source-name">{source.name}</span>
          </li>
        ))}
      </ul>
      <p className="data-sources-note">{t('We combine data from many exchanges so every coin is covered and the aggregated figures are as accurate as possible.')}</p>
    </section>
  );
}
