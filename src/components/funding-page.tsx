import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowDown, ArrowDownUp, ArrowLeft, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Clock3, RefreshCw, Search } from 'lucide-react';
import { CoinLogo } from '@/components/coin-logo';
import { ExchangeLogo } from '@/components/exchange-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { useFundingSnapshot } from '@/hooks/use-funding-snapshot';
import { EXCHANGE_LABELS, MARKET_EXCHANGES } from '@/lib/exchange-options';
import { orderFundingSources } from '@/lib/funding-source-order';
import type { MarketExchange } from '@/types/market';
import type { FundingRow, FundingSource, FundingTimeframe, FundingVenue } from '@/types/funding';
import '@/styles/funding.css';

const TIMEFRAMES: { value: FundingTimeframe; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: '1d', label: '1 Day' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '1y', label: '1 Year' },
];
const HIGHLIGHT_ASSETS = ['BTC', 'ETH', 'SOL', 'HYPE'];
const PAGE_SIZE = 50;
type SortField = 'aggregate' | string;
type SortDirection = 'asc' | 'desc';

function isKnownExchange(exchange: string): exchange is MarketExchange {
  return (MARKET_EXCHANGES as string[]).includes(exchange);
}

function exchangeLabel(exchange: string) {
  const brandLabels: Record<string, string> = {
    kucoin: 'KuCoin',
    mexc: 'MEXC',
    kraken: 'Kraken',
    bingx: 'BingX',
    hyperliquid: 'Hyperliquid',
    htx: 'HTX',
    deribit: 'Deribit',
    aster: 'Aster',
    lighter: 'Lighter',
    paradex: 'Paradex',
    coinex: 'CoinEx',
    bitmex: 'BitMEX',
  };
  return isKnownExchange(exchange) ? EXCHANGE_LABELS[exchange] : brandLabels[exchange.toLowerCase()] ?? exchange;
}

function ExchangeMark({ exchange }: { exchange: string }) {
  if (isKnownExchange(exchange)) return <ExchangeLogo exchange={exchange} />;
  return <span className="funding-exchange-fallback" aria-hidden="true">{exchange.slice(0, 2).toUpperCase()}</span>;
}

function formatPct(value: number | null | undefined, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(Math.abs(value));
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatted}%`;
}

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function periodLabel(timeframe: FundingTimeframe) {
  return TIMEFRAMES.find((item) => item.value === timeframe)?.label ?? 'Current';
}

function currentRateDetail(venue: FundingVenue | undefined) {
  if (!venue) return 'No eligible exchange reading';
  const native = venue.nativeRatePct === null ? 'Native rate unavailable' : `Native ${formatPct(venue.nativeRatePct)}`;
  const interval = venue.intervalHours === null ? 'interval unknown / mixed' : `${venue.intervalHours}h`;
  return `${native} (${interval})`;
}

function sourceStatusLabel(status: string) {
  if (status === 'live') return 'live';
  if (status === 'refreshing') return 'refreshing';
  if (status === 'connecting') return 'connecting';
  if (status === 'delayed') return 'delayed';
  if (status === 'error') return 'error';
  return status;
}

function FundingHeader() {
  return (
    <header className="topbar module-topbar funding-topbar">
      <Link href="/" className="module-brand" aria-label="Crypto Order Flow home">
        <span className="brand-mark">FR</span>
        <span className="module-brand-copy"><strong>Funding Rate</strong><small>PERPETUAL MARKETS</small></span>
      </Link>
      <div className="module-topbar-right">
        <span className="funding-current-module" aria-current="page">FR <span>Funding Rate</span></span>
        <Link href="/" className="module-home-link"><ArrowLeft size={15} aria-hidden="true" /> Home</Link>
        <ThemeToggle />
      </div>
    </header>
  );
}

function FundingSourceLine({ sources }: { sources?: FundingSource[] }) {
  const visibleSources = orderFundingSources(sources ?? []).filter((source) => source.status !== 'excluded');
  return (
    <div className="funding-source-line" aria-label="Funding source status" role="status" aria-live="polite">
      <strong><span className="funding-label-dot" aria-hidden="true" />Total Fetched Coin Data</strong>
      <div className="funding-source-list">
        {visibleSources.length === 0
          ? <span className="funding-source-waiting">Source status unavailable</span>
          : visibleSources.map((source) => {
            const state = source.status === 'error' ? 'error'
              : source.status === 'live' && source.marketCount > 0 ? 'live'
              : source.status === 'delayed' ? 'delayed' : 'pending';
            const title = source.error
              ? `${exchangeLabel(source.exchange)}: ${sourceStatusLabel(source.status)} — ${source.error}`
              : `${exchangeLabel(source.exchange)}: ${sourceStatusLabel(source.status)}; ${source.marketCount.toLocaleString()} markets${source.eligible ? '; eligible for aggregation' : ''}`;
            return (
              <span key={source.exchange} className={`funding-source-item ${state}`} title={title}>
                <span className="funding-source-dot" aria-hidden="true" />
                <span>{exchangeLabel(source.exchange)}</span>
                <span className="sr-only"> — {sourceStatusLabel(source.status)}{source.error ? `: ${source.error}` : ''}</span>
              </span>
            );
          })}
      </div>
    </div>
  );
}

function FundingExchangeFilter({
  exchanges,
  selected,
  onChange,
}: {
  exchanges: string[];
  selected: string[] | null;
  onChange: (selection: string[] | null) => void;
}) {
  const active = selected ?? exchanges;
  const label = selected === null || active.length === exchanges.length
    ? 'All qualifying'
    : active.length === 0 ? 'No exchanges' : `${active.length} selected`;
  return (
    <details className="funding-exchange-filter">
      <summary aria-label={`Filter exchanges: ${label}`}>
        <span>{label}</span><ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div className="funding-filter-menu">
        <div className="funding-filter-actions">
          <button type="button" onClick={() => onChange(null)}>Select all</button>
          <button type="button" onClick={() => onChange([])}>Clear</button>
        </div>
        <fieldset>
          <legend>Qualifying exchanges</legend>
          {exchanges.map((exchange) => (
            <label key={exchange}>
              <input
                type="checkbox"
                checked={active.includes(exchange)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...active, exchange]
                    : active.filter((item) => item !== exchange);
                  onChange(next.length === exchanges.length ? null : next);
                }}
              />
              <ExchangeMark exchange={exchange} /><span>{exchangeLabel(exchange)}</span>
            </label>
          ))}
        </fieldset>
        <p>Rows match any selected qualifying exchange.</p>
      </div>
    </details>
  );
}

function sortValue(row: FundingRow, field: SortField): number | null {
  return field === 'aggregate' ? row.aggregatePct : row.venues[field]?.valuePct ?? null;
}

function SortButton({
  field,
  label,
  sortField,
  direction,
  onSort,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  direction: SortDirection;
  onSort: (field: SortField) => void;
}) {
  const active = field === sortField;
  return (
    <button type="button" className="funding-sort-button" onClick={() => onSort(field)}
      aria-label={`Sort by ${label} funding rate ${active && direction === 'desc' ? 'ascending' : 'descending'}`}
      aria-pressed={active}>
      <span>{label}</span>
      {active ? direction === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" /> : <ArrowDownUp aria-hidden="true" />}
    </button>
  );
}

function FundingRateCell({ venue, timeframe }: { venue?: FundingVenue; timeframe: FundingTimeframe }) {
  if (!venue) return <td className="funding-rate-cell is-missing"><span title="No eligible exchange reading">—</span></td>;
  if (timeframe !== 'current' && !venue.historyComplete) {
    return <td className="funding-rate-cell is-missing">
      <span title={venue.historyNote ?? 'Settled funding history is incomplete.'}>—</span>
      <small>{venue.historyNote ?? 'History incomplete'}</small>
    </td>;
  }
  const value = venue.valuePct;
  return (
    <td className={`funding-rate-cell ${value === null ? 'is-missing' : value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : ''}`}>
      <span title={timeframe === 'current' ? currentRateDetail(venue) : `${periodLabel(timeframe)} settled funding sum`}>
        {formatPct(value)}
      </span>
      <small>{timeframe === 'current' ? currentRateDetail(venue) : 'settled sum'}</small>
    </td>
  );
}

function FundingPageSkeleton() {
  return (
    <div className="funding-skeleton" aria-label="Loading funding data" role="status">
      <div className="funding-skeleton-highlights">{HIGHLIGHT_ASSETS.map((asset) => <span key={asset} />)}</div>
      <div className="funding-skeleton-table">{Array.from({ length: 8 }, (_, index) => <span key={index} />)}</div>
    </div>
  );
}

export function FundingPage() {
  const [timeframe, setTimeframe] = useState<FundingTimeframe>('current');
  const [search, setSearch] = useState('');
  const [selectedExchanges, setSelectedExchanges] = useState<string[] | null>(null);
  const [sortField, setSortField] = useState<SortField>('aggregate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(0);
  const query = useFundingSnapshot(timeframe);
  const snapshot = query.data;
  const exchanges = useMemo(
    () => orderFundingSources(snapshot?.sources ?? []).filter((source) => source.eligible && source.status !== 'excluded').map((source) => source.exchange),
    [snapshot?.sources],
  );
  const selected = useMemo(
    () => selectedExchanges === null ? exchanges : selectedExchanges.filter((exchange) => exchanges.includes(exchange)),
    [selectedExchanges, exchanges],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (snapshot?.rows ?? [])
      .filter((row) => {
        const matchesSearch = !term || row.asset.toLowerCase().includes(term)
          || row.displayAsset.toLowerCase().includes(term)
          || Object.values(row.venues).some((venue) => venue.contracts.some((contract) => contract.symbol.toLowerCase().includes(term)));
        const matchesVenue = selected.length > 0 && selected.some((exchange) => Boolean(row.venues[exchange]));
        return matchesSearch && matchesVenue;
      })
      .sort((left, right) => {
        const a = sortValue(left, sortField);
        const b = sortValue(right, sortField);
        if (a === null || !Number.isFinite(a)) return b === null || !Number.isFinite(b) ? left.asset.localeCompare(right.asset) : 1;
        if (b === null || !Number.isFinite(b)) return -1;
        return (a - b) * (sortDirection === 'asc' ? 1 : -1) || left.asset.localeCompare(right.asset);
      });
  }, [snapshot?.rows, search, selected, sortField, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visibleRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('desc'); }
    setPage(0);
  };
  const errorMessage = query.error instanceof Error ? query.error.message : 'Funding data is unavailable.';
  const loading = query.isLoading && !snapshot;

  return (
    <div className="terminal funding-app">
      <FundingHeader />
      <main className="funding-main">
        <div className="funding-heading">
          <div><span className="eyebrow">PERPETUAL MARKET SCREENER / FR</span><h1>Funding Rate</h1></div>
          <button type="button" className="refresh-button funding-refresh" onClick={() => { void query.refetch(); }} disabled={query.isFetching}
            aria-label={query.isFetching ? 'Refreshing funding data' : 'Refresh funding data'}>
            <RefreshCw className={query.isFetching ? 'spin' : ''} aria-hidden="true" /><span>{query.isFetching ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>

        <section className="funding-controls" aria-label="Funding rate controls">
          <div className="funding-timeframes" role="group" aria-label="Funding history timeframe">
            {TIMEFRAMES.map((item) => <button key={item.value} type="button" className={timeframe === item.value ? 'active' : ''}
              aria-pressed={timeframe === item.value} onClick={() => { setTimeframe(item.value); setPage(0); }}>
              {item.label}
            </button>)}
          </div>
          <div className="funding-filter-controls">
            <label className="funding-search">
              <Search size={15} aria-hidden="true" />
              <input type="search" value={search} placeholder="Search coin or contract" aria-label="Search coins and contracts"
                onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
            </label>
            <span className="funding-filter-label">Exchange</span>
            <FundingExchangeFilter exchanges={exchanges} selected={selectedExchanges} onChange={setSelectedExchanges} />
          </div>
        </section>

        <p className="funding-comparison-note">
          <strong>Default comparison: 8 hours.</strong> Current funding rates are converted to an equivalent 8-hour rate for fair comparison. Each exchange’s native rate and actual interval are shown separately. Historical timeframes show actual settled funding totals.
        </p>

        <FundingSourceLine sources={snapshot?.sources} />

        {query.isError && (
          <div className={`funding-error ${snapshot ? 'is-stale' : ''}`} role="alert">
            <span>{snapshot ? `Could not refresh. Showing the last available funding snapshot. ${errorMessage}` : errorMessage}</span>
            <button type="button" onClick={() => { void query.refetch(); }}>Retry</button>
          </div>
        )}

        <section className="funding-highlights" aria-label="OI-weighted funding highlights">
          {HIGHLIGHT_ASSETS.map((asset) => {
            const highlight = snapshot?.highlights.find((item) => item.asset.toUpperCase() === asset);
            const value = highlight?.valuePct ?? null;
            return (
              <article className="funding-highlight" key={asset}>
                <div className="funding-highlight-asset"><CoinLogo asset={asset} /><strong>{asset}</strong></div>
                <span className={`funding-highlight-value ${value === null ? 'is-missing' : value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : ''}`}>
                  {loading ? <i className="funding-skeleton-line" /> : formatPct(value)}
                </span>
                <small>{timeframe === 'current' ? 'OI-weighted · normalized 8h' : `${periodLabel(timeframe)} settled sum`} · {highlight ? `${highlight.sourceCount} sources` : 'unavailable'}</small>
              </article>
            );
          })}
        </section>

        <section className="funding-extremes" aria-label="Highest and lowest exchange funding rates">
          <FundingExtremeList title="Highest exchange funding" rows={snapshot?.extremes.highest ?? []} loading={loading} />
          <FundingExtremeList title="Lowest exchange funding" rows={snapshot?.extremes.lowest ?? []} loading={loading} />
        </section>

        <section className="funding-basis" aria-label="Funding rate methodology">
          <span className="funding-basis-mark">i</span>
          <p>
            {snapshot
              ? <>OI-weighted aggregate across qualifying venues. Global cutoff: each venue must hold at least {snapshot.oiThresholdPct.toFixed(2)}% of fetched USD open interest; applied globally, not per coin. Fetched denominator: {formatUsd(snapshot.totalOpenInterestUsd)}. Coverage may be incomplete while sources are connecting, delayed, or failed.</>
              : 'OI-weighted aggregate across qualifying venues. Global venue eligibility is based on share of fetched USD open interest, not per-coin share.'}
            {' '}Current aggregates use current OI weights. Historical settled sums use only venues with complete history, so historical coverage can be narrower; windows end at the latest full UTC hour. Incomplete history is unavailable, not estimated.
          </p>
          {snapshot && !snapshot.universeReady && <strong className="funding-universe-note">Exchange universe still loading; eligibility may change.</strong>}
        </section>

        <div className="funding-table-meta">
          <span><strong>{snapshot ? rows.length.toLocaleString() : '—'}</strong> coins · sorted by {sortField === 'aggregate' ? 'OI-weighted rate' : exchangeLabel(sortField)} ({sortDirection === 'asc' ? 'ascending' : 'descending'})</span>
          <span><Clock3 size={13} aria-hidden="true" /> {snapshot?.generatedAt ? `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Waiting for first snapshot'}{snapshot?.isRefreshing ? ' · refresh in progress' : ''}</span>
        </div>

        <div className="funding-table-shell">
          <div className="funding-table-scroll" role="region" aria-label="Funding rates by qualifying exchange" tabIndex={0}>
            <table className="funding-table">
              <thead>
                <tr>
                  <th scope="col" className="funding-coin-heading">Coin</th>
                  <th scope="col" aria-sort={sortField === 'aggregate' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>
                    <SortButton field="aggregate" label="OI-weighted Funding Rate" sortField={sortField} direction={sortDirection} onSort={handleSort} />
                    <small>{timeframe === 'current' ? 'normalized 8h' : `${periodLabel(timeframe)} settled sum`}</small>
                  </th>
                  {exchanges.map((exchange) => <th key={exchange} scope="col" aria-sort={sortField === exchange ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>
                    <SortButton field={exchange} label={exchangeLabel(exchange)} sortField={sortField} direction={sortDirection} onSort={handleSort} />
                    <small>{timeframe === 'current' ? 'normalized 8h' : 'settled sum'}</small>
                  </th>)}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={exchanges.length + 2}><FundingPageSkeleton /></td></tr>}
                {!loading && !query.isError && snapshot && rows.length === 0 && (
                  <tr><td colSpan={exchanges.length + 2}><div className="funding-empty"><span className="funding-empty-mark">FR</span><strong>No funding rows match</strong><p>{search || selected.length !== exchanges.length ? 'Adjust your search or exchange selection.' : 'No eligible market readings are available in this snapshot.'}</p></div></td></tr>
                )}
                {!loading && snapshot && visibleRows.map((row) => {
                  const rowVenues = Object.values(row.venues);
                  const incompleteVenue = rowVenues.find((venue) => !venue.historyComplete);
                  const aggregateValue = timeframe !== 'current'
                    && (rowVenues.length === 0 || Boolean(incompleteVenue))
                    ? null : row.aggregatePct;
                  const aggregateUnavailable = timeframe !== 'current' && incompleteVenue?.historyNote
                    ? incompleteVenue.historyNote : timeframe !== 'current'
                      ? 'Complete settled history is unavailable.' : 'No aggregate reading available.';
                  return (
                    <tr key={row.asset}>
                      <td className="funding-coin-cell">
                        <div className="funding-coin-content">
                          <span className="funding-coin-logo"><CoinLogo asset={row.asset} /></span>
                          <span><strong>{row.displayAsset || row.asset}</strong><small>{row.asset}</small></span>
                        </div>
                      </td>
                      <td className={`funding-rate-cell funding-aggregate ${aggregateValue === null ? 'is-missing' : aggregateValue > 0 ? 'is-positive' : aggregateValue < 0 ? 'is-negative' : ''}`}>
                        <span title={aggregateValue === null ? aggregateUnavailable : timeframe === 'current' ? 'OI-weighted normalized 8-hour rate' : `${periodLabel(timeframe)} settled funding sum`}>
                          {formatPct(aggregateValue)}
                        </span>
                        <small>{timeframe === 'current' ? `${row.sourceCount} eligible sources` : aggregateValue === null ? 'history unavailable' : 'settled sum'}</small>
                      </td>
                      {exchanges.map((exchange) => <FundingRateCell key={exchange} venue={row.venues[exchange]} timeframe={timeframe} />)}
                    </tr>
                  );
                })}
                {!loading && !snapshot && query.isError && <tr><td colSpan={exchanges.length + 2}>
                  <div className="funding-empty funding-empty-error"><span className="funding-empty-mark">FR</span><strong>Funding snapshot unavailable</strong><p>Live funding data could not be reached. Retry when the market feed is available.</p></div>
                </td></tr>}
                {!loading && snapshot && rows.length > 0 && visibleRows.length === 0 && <tr><td colSpan={exchanges.length + 2}><div className="funding-empty"><strong>No rows on this page</strong></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {rows.length > PAGE_SIZE && <nav className="funding-pagination" aria-label="Funding table pages">
          <span>Page {page + 1} of {pageCount} · {rows.length.toLocaleString()} coins</span>
          <div>
            <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}><ChevronLeft size={15} aria-hidden="true" />Previous</button>
            <button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1}>Next<ChevronRight size={15} aria-hidden="true" /></button>
          </div>
        </nav>}
        <footer className="funding-footline"><span>CRYPTO ORDER FLOW / FUNDING RATE</span><span>{snapshot ? `${exchanges.length} ELIGIBLE VENUES · ${timeframe.toUpperCase()}` : 'AWAITING MARKET SNAPSHOT'}</span></footer>
      </main>
    </div>
  );
}

function FundingExtremeList({
  title,
  rows,
  loading,
}: {
  title: string;
  rows: Array<{ asset: string; exchange: string; valuePct: number; nativeRatePct: number | null; intervalHours: number | null }>;
  loading: boolean;
}) {
  return (
    <article className="funding-extreme-panel">
      <h2>{title}</h2>
      {loading ? <div className="funding-extreme-loading"><i /><i /><i /></div> : rows.length === 0 ? (
        <p className="funding-extreme-empty">No qualifying readings available.</p>
      ) : <ol>
        {rows.slice(0, 5).map((item, index) => (
          <li key={`${item.asset}-${item.exchange}-${index}`}>
            <span className="funding-extreme-rank">{String(index + 1).padStart(2, '0')}</span>
            <CoinLogo asset={item.asset} />
            <span className="funding-extreme-name"><strong>{item.asset}</strong><small><ExchangeMark exchange={item.exchange} />{exchangeLabel(item.exchange)}</small></span>
            <span className={`funding-extreme-value ${item.valuePct > 0 ? 'is-positive' : item.valuePct < 0 ? 'is-negative' : ''}`}>
              {formatPct(item.valuePct)}
              <small>{item.nativeRatePct === null ? 'native unavailable' : `${formatPct(item.nativeRatePct)} (${item.intervalHours === null ? 'interval unknown / mixed' : `${item.intervalHours}h`})`}</small>
            </span>
          </li>
        ))}
      </ol>}
    </article>
  );
}
