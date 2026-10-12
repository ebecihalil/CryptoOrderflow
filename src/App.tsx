import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import type {
  HealthStatus,
  LsarInstrument,
  LsarMarketSnapshot,
  LsarMarketSummary,
  LsarTimeframe,
  MarketExchange,
} from '@/types/market';
import {
  AlertCircle,
  ArrowDown,
  ArrowDownUp,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Database,
  Info,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

const TIMEFRAMES: LsarTimeframe[] = ['5m', '15m', '30m', '1h', '4h', '24h'];

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    const message = typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return await response.json() as T;
}

function formatPrice(value: number) {
  if (value === 0) return '0.00';
  if (Math.abs(value) >= 1) {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }
  if (Math.abs(value) < 1e-7) return value.toExponential(4);
  const decimals = Math.min(10, Math.max(2, Math.ceil(-Math.log10(Math.abs(value))) + 3));
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals }).format(value);
}

function formatUsd(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatPct(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function formatPp(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} pp`;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}

function rowChange(row: LsarInstrument, timeframe: LsarTimeframe) {
  return row.changes.find((change) => change.timeframe === timeframe);
}

function MoveHighlight({ asset, value, direction }: { asset: string; value: number | null; direction: 'up' | 'down' }) {
  if (!asset || value === null) return <div className="move-line">No signal</div>;
  const Icon = direction === 'up' ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={`move-line ${direction}`} data-testid={`text-strongest-${direction}`}>
      <Icon size={14} />
      <span className="move-asset">{asset}</span>
      <span>{formatPct(value)}</span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 7 }, (_, index) => (
        <tr className="skeleton-row" key={index} data-testid={`row-skeleton-${index}`}>
          <td><span className="skeleton" style={{ width: 66 }} /></td>
          <td><span className="skeleton" style={{ width: 75 }} /></td>
          {TIMEFRAMES.flatMap((timeframe) => [
            <td key={`${timeframe}-a`}><span className="skeleton" style={{ width: 54 }} /></td>,
            <td key={`${timeframe}-b`}><span className="skeleton" style={{ width: 48 }} /></td>,
          ])}
          <td><span className="skeleton" style={{ width: 50 }} /></td>
          <td><span className="skeleton" style={{ width: 58 }} /></td>
        </tr>
      ))}
    </>
  );
}

function Home() {
  const [timeframe, setTimeframe] = useState<LsarTimeframe>('1h');
  const [sortMode, setSortMode] = useState<'increase' | 'decrease' | 'absolute'>('absolute');
  const [exchangeFilter, setExchangeFilter] = useState<'all' | MarketExchange | 'both'>('all');
  const [search, setSearch] = useState('');
  const [maxPrice, setMaxPrice] = useState('5');
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);

  const parsedMaxPrice = maxPrice.trim() === '' ? null : Number(maxPrice);
  const maxPriceLimit =
    parsedMaxPrice !== null && Number.isFinite(parsedMaxPrice) && parsedMaxPrice >= 0
      ? parsedMaxPrice
      : null;
  const serverPriceFilter = maxPriceLimit === null ? 'all' : String(maxPriceLimit);
  const snapshotQuery = useQuery({
    queryKey: ['market-snapshot', serverPriceFilter],
    queryFn: ({ signal }) => getJson<LsarMarketSnapshot>(`/api/market/lsar?maxPrice=${encodeURIComponent(serverPriceFilter)}`, signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const summaryQuery = useQuery({
    queryKey: ['market-summary', timeframe],
    queryFn: ({ signal }) => getJson<LsarMarketSummary>(`/api/market/summary?timeframe=${encodeURIComponent(timeframe)}`, signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => getJson<HealthStatus>('/api/healthz', signal),
    refetchInterval: 60_000,
    retry: 1,
  });

  const snapshot = snapshotQuery.data;
  const summary = summaryQuery.data;
  const isFetching = snapshotQuery.isFetching || summaryQuery.isFetching;
  const sortByTimeframe = (value: LsarTimeframe) => {
    const nextSort = value === timeframe && sortMode === 'increase' ? 'decrease' : 'increase';
    setTimeframe(value);
    setSortMode(nextSort);
  };

  const rows = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    const filtered = (snapshot?.rows ?? []).filter((row) => {
      const matchesAsset = !searchTerm || row.asset.toLowerCase().includes(searchTerm)
        || (row.displayAsset ?? row.asset).toLowerCase().includes(searchTerm)
        || row.exchangeReadings.some((reading) => reading.symbol.toLowerCase().includes(searchTerm));
      const matchesExchange =
        exchangeFilter === 'all' ||
        (exchangeFilter === 'both' ? row.exchanges.length > 1 : row.exchanges.includes(exchangeFilter));
      return matchesAsset && matchesExchange;
    });
    return filtered.sort((a, b) => {
      const aValue = rowChange(a, timeframe)?.ratioChangePct ?? null;
      const bValue = rowChange(b, timeframe)?.ratioChangePct ?? null;
      if (aValue === null && bValue === null) return a.asset.localeCompare(b.asset);
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      if (sortMode === 'increase') return bValue - aValue;
      if (sortMode === 'decrease') return aValue - bValue;
      return Math.abs(bValue) - Math.abs(aValue);
    });
  }, [snapshot?.rows, search, exchangeFilter, timeframe, sortMode]);

  const handleRefresh = () => {
    void Promise.allSettled([snapshotQuery.refetch(), summaryQuery.refetch()]);
  };

  const hasActiveFilters = Boolean(search.trim()) || exchangeFilter !== 'all' || maxPriceLimit !== null;
  const latestTimestamp = snapshot?.generatedAt ?? summary?.generatedAt ?? null;
  const latestRatioTimestamp =
    snapshot?.rows.reduce<string | null>((latest, row) => {
      const observed = row.changes.find((change) => change.timeframe === '5m')?.currentTimestamp ?? null;
      if (!observed) return latest;
      return !latest || new Date(observed).getTime() > new Date(latest).getTime() ? observed : latest;
    }, null) ?? null;
  const snapshotFailed = Boolean(snapshotQuery.isError);
  const queryErrorMessage = snapshotQuery.error instanceof Error ? snapshotQuery.error.message : 'The market snapshot could not be reached.';

  return (
    <div className="terminal">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">LS</div>
          <span>Perpetual LSAR</span>
          <span className="brand-sub">market scanner</span>
        </div>
        <div className="topbar-right">
          <span className={`live-indicator ${healthQuery.isError ? 'api-down' : ''}`} data-testid="status-api-health">
            <span className="live-dot" />
            {healthQuery.isError ? 'API unreachable' : 'Market feed'}
          </span>
        </div>
      </header>

      {snapshot?.isRefreshing && <div className="refreshing-bar" data-testid="status-refreshing" />}

      <main className="main-wrap">
        <section className="hero-line">
          <div>
            <div className="eyebrow">Cross-exchange positioning / perpetuals</div>
            <h1 className="page-title">Long Short Account Ratio (LSAR)</h1>
            <p className="page-subtitle">OI-weighted account positioning across perpetual markets. Each coin lists its contributing exchanges.</p>
          </div>
          <button className="refresh-button" onClick={handleRefresh} disabled={isFetching} data-testid="button-refresh">
            <RefreshCw className={isFetching ? 'spin' : ''} />
            {isFetching ? 'Loading snapshot' : 'Refresh'}
          </button>
        </section>

        {snapshotFailed && (
          <div className={`status-banner ${snapshot ? '' : 'error'}`} role="status" data-testid="status-snapshot-error">
            <AlertCircle />
            <span>
              {snapshot
                ? `Could not refresh the latest market data. Showing the last available snapshot${queryErrorMessage ? ` — ${queryErrorMessage}` : ''}.`
                : `Live market data is unavailable. ${queryErrorMessage}`}
            </span>
            <button onClick={handleRefresh} data-testid="button-retry">Retry</button>
          </div>
        )}

        <section className="control-panel" aria-label="Screener filters">
          <div className="control-left">
            <label className="searchbox">
              <Search aria-hidden="true" />
              <input
                type="search"
                placeholder="Search asset"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-testid="input-search-asset"
                aria-label="Search assets"
              />
            </label>
            <span className="filter-label">Exchange</span>
            <select value={exchangeFilter} onChange={(event) => setExchangeFilter(event.target.value as typeof exchangeFilter)} className="select-control" data-testid="select-exchange">
              <option value="all">All sources</option>
              <option value="binance">Binance</option>
              <option value="bybit">Bybit</option>
              <option value="okx">OKX</option>
              <option value="gate">Gate.io</option>
              <option value="bitget">Bitget</option>
              <option value="both">Multiple sources</option>
            </select>
            <span className="filter-label">Window</span>
            <select value={timeframe} onChange={(event) => setTimeframe(event.target.value as LsarTimeframe)} className="select-control" data-testid="select-timeframe">
              {TIMEFRAMES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <label className="price-filter">
              <span className="filter-label">Max price</span>
              <span className="price-input-wrap">
                <span aria-hidden="true">$</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={maxPrice}
                  onChange={(event) => setMaxPrice(event.target.value)}
                  placeholder="No limit"
                  aria-label="Maximum coin price in USD"
                  data-testid="input-max-price"
                />
              </span>
            </label>
          </div>
          <div className="control-right">
            <span className="filter-label">Sort</span>
            <div className="sort-toggle" role="group" aria-label="Sort markets" data-testid="group-sort-mode">
              <button className={sortMode === 'increase' ? 'active' : ''} onClick={() => setSortMode('increase')} data-testid="button-sort-increase">Most increased</button>
              <button className={sortMode === 'decrease' ? 'active' : ''} onClick={() => setSortMode('decrease')} data-testid="button-sort-decrease">Most decreased</button>
              <button className={sortMode === 'absolute' ? 'active' : ''} onClick={() => setSortMode('absolute')} data-testid="button-sort-absolute">Largest move</button>
            </div>
          </div>
        </section>

        <div className="table-meta">
          <span>
            <strong>{snapshot ? rows.length.toLocaleString() : '—'}</strong> assets shown
            {maxPriceLimit !== null && <> · price ≤ ${formatPrice(maxPriceLimit)}</>}
            {' · '}sorted by {sortMode === 'absolute' ? 'largest absolute move' : sortMode === 'increase' ? 'strongest increase' : 'strongest decrease'} in {timeframe}
          </span>
          <span data-testid="text-last-updated"><Clock3 size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Fetched {formatTimestamp(latestTimestamp)} · latest LSAR sample {formatTimestamp(latestRatioTimestamp)}{snapshot?.isRefreshing ? ' · refresh in progress' : ''}</span>
        </div>

        <div className="table-shell">
          <div className="table-scroll">
            <table className="market-table">
              <thead>
                <tr>
                  <th scope="col" className="price-col sticky-price">Price <span className="subhead">USD · 24h move</span></th>
                  <th scope="col" className="asset-col">Asset</th>
                  {TIMEFRAMES.map((value) => (
                    <th
                      scope="col"
                      colSpan={2}
                      key={value}
                      aria-sort={value === timeframe && sortMode !== 'absolute' ? (sortMode === 'increase' ? 'descending' : 'ascending') : 'none'}
                    >
                      <button
                        type="button"
                        className="timeframe-sort"
                        onClick={() => sortByTimeframe(value)}
                        aria-label={`Sort ${value} by ratio-relative LSAR change${value === timeframe && sortMode === 'decrease' ? ' ascending' : ' descending'}`}
                        aria-pressed={value === timeframe && sortMode !== 'absolute'}
                        data-testid={`button-sort-timeframe-${value}`}
                      >
                        <span>LSAR change · {value}</span>
                        {value === timeframe && sortMode !== 'absolute'
                          ? sortMode === 'increase' ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />
                          : <ArrowDownUp aria-hidden="true" />}
                      </button>
                      <span className="subhead">ratio-relative % / long-share Δpp</span>
                    </th>
                  ))}
                  <th scope="col">Current LSAR <span className="subhead">ratio / long share</span></th>
                  <th scope="col">Open interest <span className="subhead">USD weighted</span></th>
                </tr>
              </thead>
              <tbody>
                {snapshotQuery.isLoading && !snapshot && <SkeletonRows />}
                {!snapshotQuery.isLoading && !snapshot && !snapshotQuery.isError && (
                  <tr><td colSpan={16}><div className="empty-state" data-testid="state-awaiting-snapshot"><Database size={23} /><h2>Connecting to the market feed</h2><p>The screener will populate when a live snapshot is available.</p></div></td></tr>
                )}
                {snapshot && rows.length === 0 && (
                  <tr><td colSpan={16}><div className="empty-state" data-testid="state-no-markets"><h2>{hasActiveFilters ? 'No markets match these filters' : 'No market readings yet'}</h2><p>{hasActiveFilters ? 'Try raising the max price, changing the exchange, or clearing your search.' : 'No rows were returned by the live snapshot.'}</p></div></td></tr>
                )}
                {snapshot && rows.map((row) => {
                  const expanded = expandedAsset === row.asset;
                  return (
                    <FragmentRow
                      key={row.asset}
                      row={row}
                      expanded={expanded}
                      onToggle={() => setExpandedAsset(expanded ? null : row.asset)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="footnote" data-testid="text-ratio-disclaimer">
          <Info />
          <span><strong>Read this correctly.</strong> Each timeframe compares the latest available sample in the current UTC-aligned candle with the latest sample in the immediately previous candle, using matching sources and identical USD OI weights. The current candle is still forming. Values show ratio-relative percent changes and long-share percentage-point changes. Account ratios do not identify institutions versus retail or measure position size. Expand a coin to see contract timestamps and the sources used for each timeframe. Binance/Bybit include linear and inverse perpetuals; Gate.io and Bitget currently add USDT perpetuals, and OKX adds swaps. Bitget loads progressively at its one-request-per-second limit; slower scans never block other venues. Readings older than 15 minutes are excluded, and a missing candle produces no fabricated change.</span>
        </div>
        {snapshot?.sources.some((source) => source.error) && <div className="footnote" role="status"><AlertCircle /><span>Some exchange data is unavailable: {snapshot.sources.filter((source) => source.error).map((source) => `${source.exchange.toUpperCase()}: ${source.error}`).join(' · ')}. Only available readings contribute.</span></div>}
        <div className="footline">
          <span>PERPETUAL LSAR SCREENER / ACCOUNT-BASED POSITIONING</span>
          <span data-testid="text-generated-at">SNAPSHOT {formatTimestamp(latestTimestamp)} · {snapshot?.totalMarkets ?? summary?.totalMarkets ?? '—'} ASSETS</span>
        </div>
      </main>
    </div>
  );
}

function FragmentRow({ row, expanded, onToggle }: { row: LsarInstrument; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr data-testid={`row-market-${row.asset}`}>
        <td className="price-cell" data-testid={`value-price-${row.asset}`}>
          {formatPrice(row.price)}
          <span className="subhead" style={{ color: row.priceChange24hPct === null ? '#a0a7a0' : row.priceChange24hPct >= 0 ? '#38816d' : '#b75b50' }}>
            {formatPct(row.priceChange24hPct)}
          </span>
        </td>
        <td className="asset-cell">
          <button onClick={onToggle} data-testid={`button-expand-${row.asset}`} aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} ${row.displayAsset ?? row.asset} exchange readings`} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 0, padding: 0, background: 'transparent', textAlign: 'left' }}>
            <span style={{ width: 15, color: '#91a09a', display: 'inline-flex' }}>{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>
            <span><span className="asset-name">{row.displayAsset ?? row.asset}</span><span className="asset-market">DATA: {row.exchanges.map((exchange) => exchange.toUpperCase()).join(' · ')}</span></span>
          </button>
        </td>
        {TIMEFRAMES.map((timeframe) => {
          const change = rowChange(row, timeframe);
          const ratio = change?.ratioChangePct ?? null;
          const share = change?.longShareChangePp ?? null;
          return (
            <Fragment key={timeframe}>
              <td className="change-cell" data-testid={`value-ratio-change-${row.asset}-${timeframe}`}>
                <span className={`change-value ${ratio === null ? 'neutral' : ratio > 0 ? 'positive' : ratio < 0 ? 'negative' : 'neutral'}`}>{formatPct(ratio)}</span>
              </td>
              <td className="change-cell" data-testid={`value-share-change-${row.asset}-${timeframe}`}>
                <span className={`change-value ${share === null ? 'neutral' : share > 0 ? 'positive' : share < 0 ? 'negative' : 'neutral'}`}>{formatPp(share)}</span>
              </td>
            </Fragment>
          );
        })}
        <td data-testid={`value-current-lsar-${row.asset}`}>
          <div className="share-context">
            <span className="ratio-number">{row.currentRatio === null ? '—' : row.currentRatio.toFixed(3)}</span>
            <span className="share-meter"><span style={{ width: `${Math.min(100, Math.max(0, row.longSharePct ?? 0))}%` }} /></span>
            <span className="share-percent">{row.longSharePct === null ? '—' : `${row.longSharePct.toFixed(1)}% long`}</span>
          </div>
        </td>
        <td className="oi-cell" data-testid={`value-open-interest-${row.asset}`}>{formatUsd(row.openInterestUsd)}</td>
      </tr>
      {expanded && (
        <tr data-testid={`row-details-${row.asset}`}>
          <td colSpan={16} style={{ background: '#f0eee6', textAlign: 'left', padding: '14px 20px 15px 38px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', alignItems: 'center' }}>
              <span className="eyebrow">Exchange readings · OI-weighting inputs</span>
              {row.exchangeReadings.map((reading) => (
                <span key={`${reading.exchange}-${reading.symbol}`} data-testid={`text-reading-${row.asset}-${reading.exchange}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', color: '#65736e', font: '10px var(--app-font-mono)' }}>
                  <strong style={{ color: '#34534c', fontWeight: 500 }}>{reading.exchange.toUpperCase()}</strong>
                  <span>{reading.symbol}</span>
                  <span>${formatPrice(reading.price)}</span>
                  <span>OI {formatUsd(reading.openInterestUsd)}</span>
                  <span>LSAR {reading.longShortRatio === null ? '—' : reading.longShortRatio.toFixed(3)}</span>
                  <span>Long {reading.longSharePct === null ? '—' : `${reading.longSharePct.toFixed(1)}%`}</span>
                  <span>Updated {formatTimestamp(reading.updatedAt)}</span>
                </span>
              ))}
              {row.exchangeReadings.length === 0 && <span style={{ color: '#89928d', fontSize: 11 }}>No exchange-level readings supplied for this instrument.</span>}
            </div>
            <div style={{ marginTop: 9, color: '#8d9690', font: '9px var(--app-font-mono)' }}>
              {TIMEFRAMES.map((timeframe) => <span key={timeframe} style={{ marginRight: 14 }}>{timeframe}: {rowChange(row, timeframe)?.exchanges?.join(' + ') || 'no matched candle data'}</span>)}
              <div style={{ marginTop: 6 }}>Only venues with data in both compared candles enter that change. When 5-minute history does not reach the previous 4h/24h candle, OKX and Bitget use hourly history for that previous candle. The current value uses their latest 5-minute sample.</div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
