import { useMemo, useState } from 'react';
import { ArrowDown, ArrowDownUp, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Clock3, RefreshCw, Search } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { CoinLogo } from '@/components/coin-logo';
import { ExchangeLogo } from '@/components/exchange-logo';
import { useOpenInterestSnapshot } from '@/hooks/use-open-interest-snapshot';
import { EXCHANGE_LABELS, MARKET_EXCHANGES } from '@/lib/exchange-options';
import { orderFundingSources } from '@/lib/funding-source-order';
import { formatOiUnits } from '@/lib/open-interest-format';
import type { MarketExchange } from '@/types/market';
import type { OiRow, OiTimeframe } from '@/types/open-interest';
import '@/styles/open-interest.css';

const TIMEFRAMES: OiTimeframe[] = ['5m', '15m', '30m', '1h', '4h', '24h'];
const PAGE_SIZE = 50;
type SortField = 'asset' | 'aggregateOiCoin' | 'changePct' | 'aggregateOiUsd' | 'oiVolumeRatio';
type SortDirection = 'asc' | 'desc';

function isKnownExchange(exchange: string): exchange is MarketExchange {
  return (MARKET_EXCHANGES as string[]).includes(exchange);
}

function exchangeLabel(exchange: string) {
  const labels: Record<string, string> = {
    kucoin: 'KuCoin', mexc: 'MEXC', kraken: 'Kraken', bingx: 'BingX',
    hyperliquid: 'Hyperliquid', htx: 'HTX', deribit: 'Deribit', aster: 'Aster',
    lighter: 'Lighter', paradex: 'Paradex', coinex: 'CoinEx', bitmex: 'BitMEX',
    cme: 'CME',
  };
  return isKnownExchange(exchange) ? EXCHANGE_LABELS[exchange] : labels[exchange.toLowerCase()] ?? exchange;
}

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const digits = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(Math.abs(value));
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${digits}%`;
}

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatUnits(value: number | null | undefined, asset: string) {
  return formatOiUnits(value, asset);
}

function formatUpdated(value: string | undefined) {
  if (!value) return 'Waiting for first snapshot';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Waiting for first snapshot' : `Updated ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function SourceLine({ sources }: { sources: ReturnType<typeof orderFundingSources> }) {
  return (
    <div className="oi-source-line" aria-label="Open interest source status" role="status" aria-live="polite">
      <strong><span className="oi-label-dot" aria-hidden="true" />Total Fetched Coin Data</strong>
      <div className="oi-source-list">
        {sources.length === 0
          ? <span className="oi-source-waiting">Source status unavailable</span>
          : sources.map((source) => {
            const state = source.status === 'error' ? 'error'
              : source.status === 'live' && source.marketCount > 0 ? 'live'
                : source.status === 'delayed' ? 'delayed' : 'pending';
            const status = source.status;
            const title = source.error
              ? `${exchangeLabel(source.exchange)}: ${status} — ${source.error}`
              : `${exchangeLabel(source.exchange)}: ${status}; ${source.marketCount.toLocaleString()} markets${source.eligible ? '; eligible for aggregation' : ''}`;
            return (
              <span key={source.exchange} className={`oi-source-item ${state}`} title={title}>
                <span className="oi-source-dot" aria-hidden="true" />
                <ExchangeLogo exchange={source.exchange} />
                <span>{exchangeLabel(source.exchange)}</span>
                <span className="oi-source-count">{source.marketCount.toLocaleString()}</span>
                <span className="sr-only"> — {status}{source.error ? `: ${source.error}` : ''}</span>
              </span>
            );
          })}
      </div>
    </div>
  );
}

function ExchangeFilter({
  exchanges,
  selected,
  onChange,
}: {
  exchanges: string[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const active = selected === null ? exchanges : selected.filter((exchange) => exchanges.includes(exchange));
  const label = selected === null || active.length === exchanges.length
    ? 'All qualifying'
    : active.length === 0 ? 'No exchanges' : `${active.length} selected`;
  return (
    <details className="oi-exchange-filter">
      <summary aria-label={`Filter exchanges: ${label}`}><span>{label}</span><ChevronDown size={13} aria-hidden="true" /></summary>
      <div className="oi-filter-menu">
        <div className="oi-filter-actions">
          <button type="button" onClick={() => onChange(null)}>Select all</button>
          <button type="button" onClick={() => onChange([])}>Clear</button>
        </div>
        <fieldset>
          <legend>Available exchanges</legend>
          {exchanges.map((exchange) => (
            <label key={exchange}>
              <input type="checkbox" checked={active.includes(exchange)} onChange={(event) => {
                const next = event.target.checked ? [...active, exchange] : active.filter((item) => item !== exchange);
                onChange(next.length === exchanges.length ? null : next);
              }} />
              <ExchangeLogo exchange={exchange} /><span>{exchangeLabel(exchange)}</span>
            </label>
          ))}
        </fieldset>
        <p>Rows include a selected venue with available open interest.</p>
      </div>
    </details>
  );
}

function ExtremePanel({ title, rows, kind, loading }: {
  title: string;
  rows: OiRow[];
  kind: 'gainer' | 'loser';
  loading: boolean;
}) {
  return (
    <article className="oi-extreme-panel">
      <h2>{title}<span>24H · aggregated change · top 5</span></h2>
      {loading ? <div aria-label={`Loading ${title.toLowerCase()}`} role="status">
        {Array.from({ length: 4 }, (_, index) => <i className="oi-skeleton-row" key={index} />)}
      </div> : rows.length === 0 ? (
        <p className="oi-extreme-empty">No {kind === 'gainer' ? 'positive' : 'negative'} changes in this snapshot.</p>
      ) : (
        <ol>
          {rows.slice(0, 5).map((row, index) => (
            <li key={row.asset}>
              <span className="oi-rank">{String(index + 1).padStart(2, '0')}</span>
              <CoinLogo asset={row.asset} />
              <span className="oi-extreme-name"><strong>{row.asset}</strong><small>{row.matchedSourceCount} matched venues</small></span>
              <span className={`oi-extreme-value ${kind === 'gainer' ? 'oi-positive' : 'oi-negative'}`}>{formatPct(row.changePct)}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function SortButton({ field, label, active, direction, onSort }: {
  field: SortField;
  label: string;
  active: boolean;
  direction: SortDirection;
  onSort: (field: SortField) => void;
}) {
  return (
    <button type="button" className="oi-sort" onClick={() => onSort(field)} aria-pressed={active}
      aria-label={`Sort by ${label}${active ? direction === 'asc' ? ' descending' : ' ascending' : ''}`}>
      <span>{label}</span>
      {active ? direction === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" /> : <ArrowDownUp aria-hidden="true" />}
    </button>
  );
}

function numericSortValue(row: OiRow, field: SortField): number | null {
  if (field === 'asset') return null;
  const value = row[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function OpenInterestPage() {
  const [timeframe, setTimeframe] = useState<OiTimeframe>('1h');
  const [search, setSearch] = useState('');
  const [selectedExchanges, setSelectedExchanges] = useState<string[] | null>(null);
  const [sortField, setSortField] = useState<SortField>('aggregateOiUsd');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(0);
  const query = useOpenInterestSnapshot(timeframe, selectedExchanges ?? []);
  const dailyQuery = useOpenInterestSnapshot('24h', selectedExchanges ?? []);
  const snapshot = query.data;
  const dailySnapshot = dailyQuery.data;
  const sources = useMemo(
    () => orderFundingSources(dailySnapshot?.sources ?? snapshot?.sources ?? []),
    [dailySnapshot?.sources, snapshot?.sources],
  );
  const exchanges = useMemo(
    () => sources.filter((source) => source.eligible && source.status !== 'excluded').map((source) => source.exchange),
    [sources],
  );
  const activeExchanges = useMemo(
    () => selectedExchanges === null ? exchanges : selectedExchanges.filter((exchange) => exchanges.includes(exchange)),
    [selectedExchanges, exchanges],
  );
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (snapshot?.rows ?? []).filter((row) => {
      const matchesTerm = !term || row.asset.toLowerCase().includes(term) || row.displayAsset.toLowerCase().includes(term);
      const matchesExchange = selectedExchanges === null
        || (activeExchanges.length > 0 && activeExchanges.some((exchange) => Boolean(row.venues[exchange])));
      return matchesTerm && matchesExchange;
    }).sort((left, right) => {
      if (sortField === 'asset') {
        const compared = left.asset.localeCompare(right.asset);
        return sortDirection === 'asc' ? compared : -compared;
      }
      const a = numericSortValue(left, sortField);
      const b = numericSortValue(right, sortField);
      if (a === null) return b === null ? left.asset.localeCompare(right.asset) : 1;
      if (b === null) return -1;
      return (a - b) * (sortDirection === 'asc' ? 1 : -1) || left.asset.localeCompare(right.asset);
    });
  }, [snapshot?.rows, search, selectedExchanges, activeExchanges, sortField, sortDirection]);
  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection(field === 'asset' ? 'asc' : 'desc'); }
    setPage(0);
  };
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const loading = query.isLoading && !snapshot;
  const dailyLoading = dailyQuery.isLoading && !dailySnapshot;
  const refreshing = query.isFetching || dailyQuery.isFetching;
  const hasExchangeSelection = selectedExchanges === null || activeExchanges.length > 0;
  const gainers = (hasExchangeSelection ? dailySnapshot?.extremes.gainers ?? [] : []).filter((row) => row.changePct !== null && Number.isFinite(row.changePct) && row.changePct > 0)
    .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).slice(0, 5);
  const losers = (hasExchangeSelection ? dailySnapshot?.extremes.losers ?? [] : []).filter((row) => row.changePct !== null && Number.isFinite(row.changePct) && row.changePct < 0)
    .sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)).slice(0, 5);
  const errorMessage = query.error instanceof Error ? query.error.message : 'Open interest data is unavailable.';
  const dailyErrorMessage = dailyQuery.error instanceof Error ? dailyQuery.error.message : 'Daily open interest rankings are unavailable.';

  return (
    <div className="terminal oi-app">
      <AppHeader title="Open Interest" mark="OI" isRefreshing={snapshot?.isRefreshing} />
      <main className="oi-main">
        <div className="oi-heading">
          <div><span className="eyebrow">Crypto Order Flow Mechanics</span><h1>Open Interest</h1></div>
          <button type="button" className="refresh-button oi-refresh" onClick={() => {
            void Promise.all([query.refetch(), ...(timeframe === '24h' ? [] : [dailyQuery.refetch()])]);
          }} disabled={refreshing}
            aria-label={refreshing ? 'Refreshing open interest snapshot' : 'Refresh open interest snapshot'}>
            <RefreshCw className={refreshing ? 'spin' : ''} aria-hidden="true" /><span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>

        <SourceLine sources={sources} />

        <section className="oi-extremes" aria-label="Largest aggregated open interest changes">
          <ExtremePanel title="Top OI gainers" rows={gainers} kind="gainer" loading={dailyLoading} />
          <ExtremePanel title="Top OI losers" rows={losers} kind="loser" loading={dailyLoading} />
        </section>

        {dailyQuery.isError && <div className="oi-error" role="alert">
          <span>{dailySnapshot ? `Could not refresh daily rankings. Showing the last available snapshot. ${dailyErrorMessage}` : dailyErrorMessage}</span>
          <button type="button" onClick={() => { void dailyQuery.refetch(); }}>Retry daily rankings</button>
        </div>}

        <section className="oi-controls" aria-label="Open interest controls">
          <div className="oi-timeframes" role="group" aria-label="Open interest change timeframe">
            {TIMEFRAMES.map((value) => <button key={value} type="button" className={timeframe === value ? 'active' : ''}
              aria-pressed={timeframe === value} onClick={() => { setTimeframe(value); setPage(0); }}>{value}</button>)}
          </div>
          <div className="oi-filter-controls">
            <label className="oi-search"><Search size={15} aria-hidden="true" />
              <input type="search" value={search} placeholder="Search coin" aria-label="Search coins"
                onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
            </label>
            <span className="oi-filter-label">Exchange</span>
            <ExchangeFilter exchanges={exchanges} selected={selectedExchanges} onChange={(next) => { setSelectedExchanges(next); setPage(0); }} />
          </div>
        </section>

        {query.isError && <div className="oi-error" role="alert">
          <span>{snapshot ? `Could not refresh. Showing the last available snapshot. ${errorMessage}` : errorMessage}</span>
          <button type="button" onClick={() => { void query.refetch(); }}>Retry</button>
        </div>}

        <div className="oi-table-meta">
          <span><strong>{snapshot ? rows.length.toLocaleString() : '—'}</strong> coins · {rows.length > 0 ? `showing ${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, rows.length)} · ` : ''}sorted by {sortField === 'asset' ? 'coin' : ({
            aggregateOiCoin: 'aggregated contract size', changePct: 'aggregated OI change', aggregateOiUsd: 'OI in dollars', oiVolumeRatio: 'OI / 24H volume ratio',
          } as Record<Exclude<SortField, 'asset'>, string>)[sortField]} ({sortDirection === 'asc' ? 'ascending' : 'descending'})</span>
          <span><Clock3 size={13} aria-hidden="true" />{formatUpdated(snapshot?.generatedAt)}{snapshot?.isRefreshing ? ' · refresh in progress' : ''}</span>
        </div>

        <div className="oi-table-shell">
          <table className="oi-table">
            <thead><tr>
              {([
                ['asset', 'Coin'],
                ['aggregateOiCoin', 'Aggregated OI Contract Size'],
                ['changePct', `Aggregated OI Change (%) · ${timeframe}`],
                ['aggregateOiUsd', 'Aggregated OI ($)'],
                ['oiVolumeRatio', 'OI / 24H Volume Ratio'],
              ] as [SortField, string][]).map(([field, label]) => (
                <th key={field} scope="col" aria-sort={sortField === field ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>
                  <SortButton field={field} label={label} active={sortField === field} direction={sortDirection} onSort={handleSort} />
                </th>
              ))}
            </tr></thead>
            <tbody>
              {loading && Array.from({ length: 7 }, (_, index) => <tr key={`loading-${index}`}><td colSpan={5}><i className="oi-skeleton-row" /></td></tr>)}
              {!loading && !snapshot && query.isError && <tr><td colSpan={5}><div className="oi-empty" role="status"><span className="oi-empty-mark">OI</span><strong>Open interest snapshot unavailable</strong><p>Live open interest could not be reached. Retry when the market feed is available.</p></div></td></tr>}
              {!loading && snapshot && rows.length === 0 && <tr><td colSpan={5}><div className="oi-empty"><span className="oi-empty-mark">OI</span><strong>{search || activeExchanges.length !== exchanges.length ? 'No coins match these filters' : 'No open interest readings yet'}</strong><p>{search || activeExchanges.length !== exchanges.length ? 'Adjust your search or exchange selection.' : 'No rows were returned by this cached snapshot.'}</p></div></td></tr>}
              {!loading && visibleRows.map((row) => {
                const change = row.changePct;
                const changeTone = change === null ? 'oi-missing' : change > 0 ? 'oi-positive' : change < 0 ? 'oi-negative' : '';
                return <tr key={row.asset}>
                  <td className="oi-coin-cell"><div className="oi-coin-content"><CoinLogo asset={row.asset} /><span><strong>{row.displayAsset || row.asset}</strong><small>{row.asset}</small></span></div></td>
                  <td title="Underlying coin units; contract sizing follows the row asset">{formatUnits(row.aggregateOiCoin, row.asset)}</td>
                  <td className={changeTone} title={`${row.matchedSourceCount} venues matched across both compared candles`}>{formatPct(change)}</td>
                  <td>{formatUsd(row.aggregateOiUsd)}</td>
                  <td className={row.oiVolumeRatio === null ? 'oi-missing' : ''}>{row.oiVolumeRatio === null || !Number.isFinite(row.oiVolumeRatio) ? '—' : row.oiVolumeRatio.toFixed(4)}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>

        {rows.length > PAGE_SIZE && <nav className="oi-pagination" aria-label="Open interest table pages">
          <span>Page {currentPage + 1} of {pageCount} · showing {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, rows.length)} of {rows.length} coins</span>
          <div>
            <button type="button" onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>
              <ChevronLeft size={15} aria-hidden="true" />Previous
            </button>
            <button type="button" onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1}>
              Next<ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        </nav>}

        <footer className="oi-footline"><span>CRYPTO ORDER FLOW / OPEN INTEREST</span><span>{snapshot ? `${exchanges.length} SOURCE VENUES · ${timeframe.toUpperCase()}` : 'AWAITING MARKET SNAPSHOT'}</span></footer>

        <p className="oi-comparison-note"><strong>Aggregated open interest is summed, not weighted.</strong> Change is calculated from venues matched across the current and previous {timeframe} candles; coverage may differ from current OI source coverage.</p>
        <section className="oi-method" aria-label="Open interest methodology and source notes">
          <span className="oi-method-mark" aria-hidden="true">i</span>
          <div className="oi-method-copy">
            <p>Open interest is summed across available venues. Percentage change compares matching venue coverage between adjacent candles; hover a change to see the number of matched venues. Current OI includes CME only when authorized real latest daily reports are available. The OI / 24H volume ratio uses paired venues with verified rolling 24-hour volume and excludes CME trading-day volume.</p>
            {snapshot?.notes.map((note, index) => <p key={`${index}-${note}`}>{note}</p>)}
            {snapshot?.cmeReportDates.length ? <p className="oi-method-dates">CME report dates: {snapshot.cmeReportDates.join(', ')}</p> : null}
          </div>
        </section>
      </main>
    </div>
  );
}
