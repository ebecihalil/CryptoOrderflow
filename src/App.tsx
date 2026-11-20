import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { ExchangeFilter } from '@/components/exchange-filter';
import { FetchedDataLine } from '@/components/fetched-data-line';
import { CoinLogo } from '@/components/coin-logo';
import { ExchangeLogo } from '@/components/exchange-logo';
import { AppHeader } from '@/components/app-header';
import { MarketAutocomplete, type AutocompleteOption } from '@/components/market-autocomplete';
import { MARKET_EXCHANGES, EXCHANGE_LABELS, matchesExchangeFilter, selectExchanges, selectMultipleOnly } from '@/lib/exchange-options';
import { exchangeAccountRatio } from '@/lib/exchange-ratios';
import { compareMarketRows, nextHeaderSortMode, type MarketSortMode, type MarketSortTarget } from '@/lib/market-sort';
import { TIMEFRAMES } from '@/lib/table-timeframes';
import { snapshotPollInterval } from '@/lib/snapshot-polling';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { ModuleComingSoon, ModuleHome } from '@/components/module-pages';
import { FundingPage } from '@/components/funding-page';
import { OpenInterestPage } from '@/components/open-interest-page';
import { LeverageEstimatePage } from '@/components/leverage-estimate-page';
import { SuperChartsPage } from '@/pages/super-charts-page';
import { MODULES } from '@/lib/modules';
import { CoinShortcuts, WatchStar } from '@/components/coin-shortcuts';
import { AuthPage, AuthPromptHost } from '@/components/auth-ui';
import { SectionWatchlist } from '@/components/section-watchlist';
import { useCoinMemory, type CoinMemory } from '@/hooks/use-coin-memory';
import { normalizeCoin } from '@/lib/coin-memory';
import './styles/modules.css';
import type {
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
} from 'lucide-react';
import {
  Link,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();


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

function SkeletonRows({ exchanges }: { exchanges: MarketExchange[] }) {
  return (
    <>
      {Array.from({ length: 7 }, (_, index) => (
        <tr className="skeleton-row" key={index} data-testid={`row-skeleton-${index}`}>
          <td><span className="skeleton" style={{ width: 78 }} /></td>
          <td><span className="skeleton" style={{ width: 54 }} /></td>
          <td><span className="skeleton" style={{ width: 72 }} /></td>
          <td><span className="skeleton" style={{ width: 58 }} /></td>
          {exchanges.map((exchange) => <td key={exchange}><span className="skeleton" style={{ width: 68 }} /></td>)}
        </tr>
      ))}
    </>
  );
}

type LsarVariant = {
  kind: 'global' | 'top';
  title: string;
  mark: string;
  heading: string;
  subtitle: string;
  exchanges: MarketExchange[];
  footnote: ReactNode;
  footline: string;
};

const TOP_TRADER_EXCHANGES: MarketExchange[] = ['binance', 'okx', 'gate'];

const GLOBAL_LSAR: LsarVariant = {
  kind: 'global',
  title: 'Global Long Short Account Ratio',
  mark: 'LS',
  heading: 'Global Long Short Account Ratio (LSAR)',
  subtitle: 'OI-weighted positioning of all accounts across perpetual markets. Each coin lists its contributing exchanges.',
  exchanges: MARKET_EXCHANGES,
  footline: 'CRYPTO ORDERFLOW / GLOBAL LSAR SCREENER',
  footnote: <span><strong>Read this correctly.</strong> Aggregated LSAR converts each source ratio to long and short account shares first, OI-weights both shares, then reconstructs the ratio; overall long percentage is the OI-weighted long share. Each timeframe compares the latest available sample in the current UTC-aligned candle with the latest sample in the immediately previous candle, using matching sources and identical current USD OI weights on both sides. The current candle is still forming. Values show ratio-relative percent changes and long-share percentage-point changes. Account ratios do not identify institutions versus retail or measure position size. Only verified crypto identities are included; stocks/ETFs and unverified tickers are excluded. Expand a coin to see contract timestamps and the selected timeframe's contributing sources. Binance/Bybit include linear and inverse perpetuals; Gate.io, Bitget and Toobit currently add USDT perpetuals, and OKX adds swaps. Toobit fetches 5-minute history for all displayed candle comparisons. Feeds load progressively; Bitget runs at its one-request-per-second limit, and slower scans never block other venues. Readings older than 15 minutes are excluded, and a missing candle produces no fabricated change.</span>,
};

const TOP_TRADER_LSAR: LsarVariant = {
  kind: 'top',
  title: 'Top Trader Long Short Account Ratio',
  mark: 'TT',
  heading: 'Top Trader Long Short Account Ratio',
  subtitle: 'OI-weighted positioning of each exchange\'s top traders across perpetual markets. Each coin lists its contributing exchanges.',
  exchanges: TOP_TRADER_EXCHANGES,
  footline: 'CRYPTO ORDERFLOW / TOP TRADER LSAR SCREENER',
  footnote: <span><strong>Read this correctly.</strong> Only exchanges that publish a top-trader account ratio contribute: Binance (USD-M and COIN-M), OKX and Gate.io. Each exchange defines its own top-trader group (Binance: the top 20% of accounts by margin balance); the groups are not identical across exchanges. Contracts, prices and USD OI weights are the same as the Global LSAR, and the aggregation is identical: each ratio becomes long/short account shares, both shares are OI-weighted, then the ratio is reconstructed. Each timeframe compares the latest sample in the current UTC-aligned candle with the previous candle, using matching sources and identical OI weights. OKX uses hourly history for previous 4h/24h candles. Bybit, Bitget and Toobit are not included because no verified top-trader account ratio is available from them. Account ratios count accounts, not position size. Readings older than 15 minutes are excluded, and a missing candle produces no fabricated change.</span>,
};

function LsarTabs({ active }: { active: LsarVariant['kind'] }) {
  return (
    <nav className="lsar-tabs" aria-label="Long Short Account Ratio views">
      <Link href="/long-short-account-ratio" className={active === 'global' ? 'active' : ''} aria-current={active === 'global' ? 'page' : undefined}
        data-testid="tab-lsar-global">Global accounts</Link>
      <Link href="/top-trader-long-short-account-ratio" className={active === 'top' ? 'active' : ''} aria-current={active === 'top' ? 'page' : undefined}
        data-testid="tab-lsar-top">Top traders</Link>
    </nav>
  );
}

function Home() {
  return <LsarScreener variant={GLOBAL_LSAR} />;
}

function TopTraderHome() {
  return <LsarScreener variant={TOP_TRADER_LSAR} />;
}

function LsarScreener({ variant }: { variant: LsarVariant }) {
  const exchanges = variant.exchanges;
  const kindQuery = variant.kind === 'top' ? '&kind=top' : '';
  const tableColumnCount = 4 + exchanges.length;
  const [timeframe, setTimeframe] = useState<LsarTimeframe>('1h');
  const [sortMode, setSortMode] = useState<MarketSortMode>('absolute');
  const [sortTarget, setSortTarget] = useState<MarketSortTarget>('change');
  const [{ selected: selectedExchanges, multipleOnly }, setExchangeSelection] = useState(() => selectExchanges(exchanges));
  const [search, setSearch] = useState('');
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
  const memory = useCoinMemory(variant.kind === 'top' ? 'lsar-top' : 'lsar-global');
  const [watchOnly, setWatchOnly] = useState(false);

  const snapshotQuery = useQuery({
    queryKey: ['market-snapshot', variant.kind, 'all'],
    queryFn: ({ signal }) => getJson<LsarMarketSnapshot>(`/api/market/lsar?maxPrice=all${kindQuery}`, signal),
    refetchInterval: (query) => snapshotPollInterval(query.state.data?.sources),
    refetchOnWindowFocus: true,
  });
  const summaryQuery = useQuery({
    queryKey: ['market-summary', variant.kind, timeframe],
    queryFn: ({ signal }) => getJson<LsarMarketSummary>(`/api/market/summary?timeframe=${encodeURIComponent(timeframe)}${kindQuery}`, signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const snapshot = snapshotQuery.data;
  const summary = summaryQuery.data;
  const isFetching = snapshotQuery.isFetching || summaryQuery.isFetching;
  const sortByTimeframe = () => {
    const nextSort = nextHeaderSortMode(sortTarget === 'change', sortMode);
    setSortTarget('change');
    setSortMode(nextSort);
  };
  const sortByTarget = (target: MarketSortTarget) => {
    setSortMode(nextHeaderSortMode(sortTarget === target, sortMode));
    setSortTarget(target);
  };
  const sortChanges = (mode: MarketSortMode) => {
    setSortTarget('change');
    setSortMode(mode);
  };

  const rows = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    const filtered = (snapshot?.rows ?? []).filter((row) => {
      const matchesAsset = !searchTerm || row.asset.toLowerCase().includes(searchTerm)
        || (row.displayAsset ?? row.asset).toLowerCase().includes(searchTerm)
        || row.exchangeReadings.some((reading) => reading.symbol.toLowerCase().includes(searchTerm));
      const matchesExchange = matchesExchangeFilter(row.exchanges, selectedExchanges, multipleOnly);
      const matchesWatch = !watchOnly || memory.watchlist.includes(normalizeCoin(row.asset));
      return matchesAsset && matchesExchange && matchesWatch;
    });
    return filtered.sort((a, b) => compareMarketRows(a, b, timeframe, sortMode, sortTarget));
  }, [snapshot?.rows, search, selectedExchanges, multipleOnly, timeframe, sortMode, sortTarget, watchOnly, memory.watchlist]);
  // Remember a coin once the search names it exactly (typed or picked).
  const { remember } = memory;
  useEffect(() => {
    const term = normalizeCoin(search);
    if (!term || !snapshot?.rows.some((row) => normalizeCoin(row.asset) === term)) return;
    const timer = window.setTimeout(() => remember(term), 700);
    return () => window.clearTimeout(timer);
  }, [search, snapshot?.rows, remember]);
  const searchOptions = useMemo<AutocompleteOption[]>(() => (snapshot?.rows ?? []).map((row) => ({
    value: row.asset,
    label: row.displayAsset ?? row.asset,
    detail: row.exchangeReadings.slice(0, 3).map((reading) => reading.symbol).join(' · ') || row.exchanges.join(' · '),
  })), [snapshot?.rows]);

  const handleRefresh = () => {
    void Promise.allSettled([snapshotQuery.refetch(), summaryQuery.refetch()]);
  };

  const hasActiveFilters = Boolean(search.trim()) || selectedExchanges.length !== exchanges.length || multipleOnly || watchOnly;
  const latestTimestamp = snapshot?.generatedAt ?? summary?.generatedAt ?? null;
  const latestRatioTimestamp =
    snapshot?.rows.reduce<string | null>((latest, row) => {
      const observed = row.changes.find((change) => change.timeframe === '5m')?.currentTimestamp ?? null;
      if (!observed) return latest;
      return !latest || new Date(observed).getTime() > new Date(latest).getTime() ? observed : latest;
    }, null) ?? null;
  const snapshotFailed = Boolean(snapshotQuery.isError);
  return (
    <div className="terminal">
      <AppHeader title={variant.title} mark={variant.mark} sectionLabel={variant.title} isRefreshing={snapshot?.isRefreshing} />

      <main className="main-wrap">
        <section className="hero-line">
          <div>
            <div className="eyebrow">Crypto Ordeflow Mechanics</div>
            <h1 className="page-title">{variant.heading}</h1>
            <p className="page-subtitle">{variant.subtitle}</p>
            <LsarTabs active={variant.kind} />
          </div>
          <FetchedDataLine sources={snapshot?.sources} exchanges={exchanges} />
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
                ? 'Could not refresh the latest market data. Showing the last available snapshot.'
                : 'Live market data is unavailable.'}
            </span>
            <button onClick={handleRefresh} data-testid="button-retry">Retry</button>
          </div>
        )}

        <div className="section-watchlist-layout">
        <div className="section-watchlist-main">
        <section className="control-panel" aria-label="Screener filters">
          <div className="control-left">
            <MarketAutocomplete className="searchbox market-autocomplete" inputClassName="lsar-search-input"
              leadingSearch value={search} options={searchOptions} label="Search assets" placeholder="Search asset"
              onChange={(value) => setSearch(value)} testId="input-search-asset" />
            <span className="filter-label">Exchange</span>
            <ExchangeFilter exchanges={exchanges} selected={selectedExchanges} onChange={(selected) => setExchangeSelection(selectExchanges(selected))}
              multipleOnly={multipleOnly} onMultipleOnlyChange={(enabled) => setExchangeSelection(selectMultipleOnly(enabled))} />
            <span className="filter-label">TF</span>
            <select value={timeframe} onChange={(event) => { setTimeframe(event.target.value as LsarTimeframe); setSortTarget('change'); }}
              aria-label="TF (timeframe)" className="select-control" data-testid="select-timeframe">
              {TIMEFRAMES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="control-right">
            <span className="filter-label">Sort</span>
            <div className="sort-toggle" role="group" aria-label="Sort markets" data-testid="group-sort-mode">
              <button className={sortTarget === 'change' && sortMode === 'increase' ? 'active' : ''} onClick={() => sortChanges('increase')} data-testid="button-sort-increase">Most increased</button>
              <button className={sortTarget === 'change' && sortMode === 'decrease' ? 'active' : ''} onClick={() => sortChanges('decrease')} data-testid="button-sort-decrease">Most decreased</button>
              <button className={sortTarget === 'change' && sortMode === 'absolute' ? 'active' : ''} onClick={() => sortChanges('absolute')} data-testid="button-sort-absolute">Largest move</button>
            </div>
          </div>
        </section>

        <CoinShortcuts memory={memory} active={search} onPick={(coin) => setSearch(coin)}
          watchOnly={watchOnly} onWatchOnlyChange={setWatchOnly} />

        <div className="table-meta">
          <span>
            <strong>{snapshot ? rows.length.toLocaleString() : '—'}</strong> assets shown
            {' · '}sorted by {sortTarget === 'current'
              ? `current aggregated LSAR (${sortMode === 'increase' ? 'high to low' : 'low to high'})`
              : sortTarget !== 'change'
                ? `${EXCHANGE_LABELS[sortTarget]} LSAR (${sortMode === 'increase' ? 'high to low' : 'low to high'})`
                : `${sortMode === 'absolute' ? 'largest absolute move' : sortMode === 'increase' ? 'strongest increase' : 'strongest decrease'} in ${timeframe}`}
          </span>
          <span data-testid="text-last-updated"><Clock3 size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Fetched {formatTimestamp(latestTimestamp)} · latest LSAR sample {formatTimestamp(latestRatioTimestamp)}{snapshot?.isRefreshing ? ' · refresh in progress' : ''}</span>
        </div>

        <div className="table-shell">
          <div className="table-scroll">
            <table className="market-table">
              <colgroup>
                <col className="market-coin" />
                <col className="market-price" />
                <col className="market-aggregate" />
                <col className="market-current" />
                {exchanges.map((exchange) => <col className="market-venue" key={exchange} />)}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="asset-col sticky-coin">Coin</th>
                  <th scope="col" className="price-col sticky-price">Price <span className="subhead">USD · 24h move</span></th>
                  <th scope="col" className="aggregate-col"
                    aria-sort={sortTarget === 'change' ? (sortMode === 'increase' ? 'descending' : sortMode === 'decrease' ? 'ascending' : 'none') : 'none'}>
                      <button
                        type="button"
                        className="timeframe-sort"
                        onClick={sortByTimeframe}
                        aria-label={`Sort ${timeframe} aggregated LSAR change ${sortTarget === 'change' && sortMode === 'increase' ? 'ascending' : 'descending'}`}
                        aria-pressed={sortTarget === 'change'}
                        data-testid={`button-sort-timeframe-${timeframe}`}
                      >
                        <span>Aggregated LSAR Change(%) · {timeframe}</span>
                        {sortTarget === 'change' && sortMode !== 'absolute'
                          ? sortMode === 'increase' ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />
                          : <ArrowDownUp aria-hidden="true" />}
                      </button>
                      <span className="subhead">ratio-relative % / long-share Δpp</span>
                  </th>
                  <th scope="col" className="current-lsar-col"
                    aria-sort={sortTarget === 'current' ? (sortMode === 'increase' ? 'descending' : 'ascending') : 'none'}>
                    <button type="button" className="timeframe-sort" onClick={() => sortByTarget('current')}
                      aria-label={`Sort current aggregated LSAR ${sortTarget === 'current' && sortMode === 'increase' ? 'ascending' : 'descending'}`}
                      aria-pressed={sortTarget === 'current'} data-testid="button-sort-current-lsar">
                      <span className="current-lsar-label"><span>Current</span><span>Aggregated LSAR</span></span>
                      {sortTarget === 'current'
                        ? sortMode === 'increase' ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />
                        : <ArrowDownUp aria-hidden="true" />}
                    </button>
                    <span className="subhead">ratio / long share</span>
                  </th>
                  {exchanges.map((exchange) => {
                    const active = sortTarget === exchange;
                    return <th key={exchange} scope="col" className="exchange-heading"
                      aria-sort={active ? (sortMode === 'increase' ? 'descending' : 'ascending') : 'none'}>
                      <button type="button" className="timeframe-sort" onClick={() => sortByTarget(exchange)}
                        aria-label={`Sort by ${EXCHANGE_LABELS[exchange]} current LSAR ${active && sortMode === 'increase' ? 'ascending' : 'descending'}`}
                        aria-pressed={active} data-testid={`button-sort-exchange-${exchange}`}>
                        <ExchangeLogo exchange={exchange} />
                        <span>{EXCHANGE_LABELS[exchange]}</span>
                        {active ? sortMode === 'increase' ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" /> : <ArrowDownUp aria-hidden="true" />}
                      </button>
                      <span className="subhead">current LSAR</span>
                    </th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {snapshotQuery.isLoading && !snapshot && <SkeletonRows exchanges={exchanges} />}
                {!snapshotQuery.isLoading && !snapshot && !snapshotQuery.isError && (
                  <tr><td colSpan={tableColumnCount}><div className="empty-state" data-testid="state-awaiting-snapshot"><Database size={23} /><h2>Connecting to the market feed</h2><p>The screener will populate when a live snapshot is available.</p></div></td></tr>
                )}
                {snapshot && rows.length === 0 && (
                  <tr><td colSpan={tableColumnCount}><div className="empty-state" data-testid="state-no-markets"><h2>{hasActiveFilters ? 'No markets match these filters' : 'No market readings yet'}</h2><p>{hasActiveFilters ? 'Try changing the exchange filter or clearing your search.' : 'No rows were returned by the live snapshot.'}</p></div></td></tr>
                )}
                {snapshot && rows.map((row) => {
                  const expanded = expandedAsset === row.asset;
                  return (
                    <FragmentRow
                      memory={memory}
                      exchanges={exchanges}
                      key={row.asset}
                      row={row}
                      selectedTimeframe={timeframe}
                      expanded={expanded}
                      onToggle={() => { if (!expanded) memory.remember(row.asset); setExpandedAsset(expanded ? null : row.asset); }}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="footnote" data-testid="text-ratio-disclaimer">
          <Info />
          {variant.footnote}
        </div>
        {snapshot?.sources.some((source) => source.error) && <div className="footnote" role="status"><AlertCircle /><span>Some exchange data is unavailable. Only available readings contribute.</span></div>}
        <div className="footline">
          <span>{variant.footline}</span>
          <span data-testid="text-generated-at">SNAPSHOT {formatTimestamp(latestTimestamp)} · {snapshot?.totalMarkets ?? summary?.totalMarkets ?? '—'} ASSETS</span>
        </div>
        </div>
        <SectionWatchlist memory={memory} section={variant.kind === 'top' ? 'Top Trader LSAR' : 'Global LSAR'}
          currentCoin={snapshot?.rows.some((row) => normalizeCoin(row.asset) === normalizeCoin(search)) ? search : null}
          onSelect={(coin) => setSearch(coin)}
          metric={(coin) => {
            const row = snapshot?.rows.find((item) => normalizeCoin(item.asset) === coin);
            if (!row || row.currentRatio === null) return null;
            const change = rowChange(row, timeframe)?.ratioChangePct ?? null;
            return { value: row.currentRatio.toFixed(3),
              detail: `${row.longSharePct?.toFixed(1) ?? '—'}% long · ${timeframe} ${formatPct(change)}`,
              tone: change === null ? 'neutral' : change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral' };
          }} />
        </div>
      </main>
    </div>
  );
}

function FragmentRow({ row, selectedTimeframe, expanded, onToggle, exchanges, memory }: { row: LsarInstrument; selectedTimeframe: LsarTimeframe; expanded: boolean; onToggle: () => void; exchanges: MarketExchange[]; memory: CoinMemory }) {
  return (
    <>
      <tr data-testid={`row-market-${row.asset}`}>
        <td className="coin-cell asset-cell" data-testid={`value-coin-${row.asset}`}>
          <span className="coin-cell-row">
          <WatchStar memory={memory} coin={row.asset} />
          <button onClick={onToggle} data-testid={`button-expand-${row.asset}`} aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} ${row.displayAsset ?? row.asset} exchange readings`} className="coin-trigger">
            <span className="coin-chevron">{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>
            <CoinLogo asset={row.asset} />
            <span><span className="asset-name">{row.displayAsset ?? row.asset}</span><span className="asset-market">DATA: {row.exchanges.map((exchange) => exchange.toUpperCase()).join(' · ')}</span></span>
          </button>
          </span>
        </td>
        <td className="price-cell" data-testid={`value-price-${row.asset}`}>
          {formatPrice(row.price)}
          <span className="subhead" style={{ color: row.priceChange24hPct === null ? 'var(--lsar-muted)' : row.priceChange24hPct >= 0 ? 'var(--lsar-positive)' : 'var(--lsar-negative)' }}>
            {formatPct(row.priceChange24hPct)}
          </span>
        </td>
        {(() => {
          const change = rowChange(row, selectedTimeframe);
          const ratio = change?.ratioChangePct ?? null;
          const share = change?.longShareChangePp ?? null;
          return <td className="aggregate-cell" data-testid={`value-aggregate-${row.asset}-${selectedTimeframe}`}>
            <span data-testid={`value-ratio-change-${row.asset}-${selectedTimeframe}`} className={`change-value ${ratio === null ? 'neutral' : ratio > 0 ? 'positive' : ratio < 0 ? 'negative' : 'neutral'}`}>{formatPct(ratio)}</span>
            <span data-testid={`value-share-change-${row.asset}-${selectedTimeframe}`} className={`aggregate-share ${share === null ? 'neutral' : share > 0 ? 'positive' : share < 0 ? 'negative' : 'neutral'}`}>{formatPp(share)}</span>
          </td>;
        })()}
        <td className="current-lsar-cell" data-testid={`value-current-lsar-${row.asset}`}>
          <div className="share-context">
            <span className="ratio-number">{row.currentRatio === null ? '—' : row.currentRatio.toFixed(3)}</span>
            <span className="share-meter"><span style={{ width: `${Math.min(100, Math.max(0, row.longSharePct ?? 0))}%` }} /></span>
            <span className="share-percent">{row.longSharePct === null ? '—' : `${row.longSharePct.toFixed(1)}% long`}</span>
          </div>
        </td>
        {exchanges.map((exchange) => {
          const ratio = exchangeAccountRatio(row.exchangeReadings, exchange);
          if (ratio === null) return <td className="exchange-ratio-cell missing" key={exchange} data-testid={`value-exchange-${row.asset}-${exchange}`}>—</td>;
          const longShare = ratio / (1 + ratio) * 100;
          const shortShare = 100 - longShare;
          return <td className="exchange-ratio-cell" key={exchange} data-testid={`value-exchange-${row.asset}-${exchange}`}>
            <div className="venue-reading">
              <strong>{ratio.toFixed(3)}</strong>
              <div className="venue-bar" aria-label={`${longShare.toFixed(1)}% long, ${shortShare.toFixed(1)}% short`}>
                <span style={{ width: `${longShare}%` }} /><span style={{ width: `${shortShare}%` }} />
              </div>
              <div className="venue-shares"><span>{longShare.toFixed(1)}%</span><span>{shortShare.toFixed(1)}%</span></div>
            </div>
          </td>;
        })}
      </tr>
      {expanded && (
        <tr data-testid={`row-details-${row.asset}`}>
          <td colSpan={4 + exchanges.length} style={{ background: 'var(--lsar-row-hover)', textAlign: 'left', padding: '14px 20px 15px 38px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', alignItems: 'center' }}>
              <span className="eyebrow">Exchange readings · OI-weighting inputs</span>
              {row.exchangeReadings.map((reading) => (
                <span key={`${reading.exchange}-${reading.symbol}`} data-testid={`text-reading-${row.asset}-${reading.exchange}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', color: 'var(--lsar-muted)', font: 'var(--lsar-detail-size, 10px) var(--app-font-mono)' }}>
                  <strong style={{ color: 'var(--lsar-strong)', fontWeight: 500 }}>{reading.exchange.toUpperCase()}</strong>
                  <span>{reading.symbol}</span>
                  <span>${formatPrice(reading.price)}</span>
                  <span>OI {formatUsd(reading.openInterestUsd)}</span>
                  <span>LSAR {reading.longShortRatio === null ? '—' : reading.longShortRatio.toFixed(3)}</span>
                  <span>Long {reading.longSharePct === null ? '—' : `${reading.longSharePct.toFixed(1)}%`}</span>
                  <span>Updated {formatTimestamp(reading.updatedAt)}</span>
                </span>
              ))}
              {row.exchangeReadings.length === 0 && <span style={{ color: 'var(--lsar-muted)', fontSize: 11 }}>No exchange-level readings supplied for this instrument.</span>}
            </div>
            <div style={{ marginTop: 9, color: 'var(--lsar-muted)', font: 'var(--lsar-detail-note-size, 9px) var(--app-font-mono)' }}>
              <span style={{ marginRight: 14 }}>{selectedTimeframe}: {rowChange(row, selectedTimeframe)?.exchanges?.join(' + ') || 'no matched candle data'}</span>
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
        <Route path="/" component={ModuleHome} />
        <Route path="/long-short-account-ratio" component={Home} />
        <Route path="/lsar" component={LsarAlias} />
        <Route path="/top-trader-long-short-account-ratio" component={TopTraderHome} />
        <Route path="/funding-rate" component={FundingPage} />
        <Route path="/open-interest" component={OpenInterestPage} />
        <Route path="/super-charts" component={SuperChartsPage} />
        <Route path="/leverage-estimate" component={LeverageEstimatePage} />
        <Route path="/signup"><AuthPage mode="signup" /></Route>
        <Route path="/signin"><AuthPage mode="signin" /></Route>
        {MODULES.filter((module) => module.path !== '/long-short-account-ratio' && module.path !== '/top-trader-long-short-account-ratio' && module.path !== '/funding-rate' && module.path !== '/open-interest' && module.path !== '/super-charts' && module.path !== '/leverage-estimate').map((module) => (
          <Route key={module.path} path={module.path}>
            <ModuleComingSoon module={module} />
          </Route>
        ))}
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function LsarAlias() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation('/long-short-account-ratio', { replace: true }); }, [setLocation]);
  return null;
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
          <AuthPromptHost />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
