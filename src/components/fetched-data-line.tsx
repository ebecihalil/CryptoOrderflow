import type { MarketSourceStatus } from '@/types/market';
import { EXCHANGE_LABELS, MARKET_EXCHANGES } from '@/lib/exchange-options';
import { ExchangeLogo } from '@/components/exchange-logo';
import { sourceFailureLabel } from '@/lib/source-failure';

export function FetchedDataLine({ sources = [] }: { sources?: MarketSourceStatus[] }) {
  return (
    <div className="fetched-data-line" role="status" aria-live="polite" aria-label="Fetched exchange contract counts"
      data-testid="fetched-data-line">
      <strong>Total Fetched Coin Data:</strong>
      {MARKET_EXCHANGES.map((exchange) => {
        const source = sources.find((item) => item.exchange === exchange);
        const count = source?.marketCount ?? 0;
        const failureLabel = sourceFailureLabel(source?.error);
        const successful = count > 0;
        const state = successful ? 'success' : source?.status === 'error' || failureLabel ? 'error' : 'pending';
        const description = successful
          ? `${count} successfully fetched perpetual contracts with valid account ratio, price and USD OI, observed within 15 minutes. Counts are before exchange filters.`
          : 'No fresh account-ratio data is currently available.';
        return (
          <span className="fetched-data-source" key={exchange} title={description} aria-label={`${EXCHANGE_LABELS[exchange]}: ${successful ? `${count.toLocaleString()} contracts fetched` : 'data unavailable'}`} data-testid={`fetched-count-${exchange}`}>
            <span className={`fetched-data-dot ${state}`} aria-hidden="true" />
            <ExchangeLogo exchange={exchange} />
            <span>{EXCHANGE_LABELS[exchange]} {count.toLocaleString()}</span>
            <span className="sr-only">{successful ? ' — data fetched successfully' : ' — no fresh data yet'}</span>
          </span>
        );
      })}
    </div>
  );
}
