import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ExchangeLogo } from '@/components/exchange-logo';
import { FundingIndicatorChart } from '@/components/funding-indicator-chart';
import {
  normalizeFundingAsset,
  useFundingIndicator,
  type FundingIndicatorMethod,
  type FundingIndicatorTimeframe,
  type FundingIndicatorWindow,
  type FundingIndicatorPoint,
} from '@/hooks/use-funding-indicator';
import '@/styles/funding-indicator.css';

const TIMEFRAMES: Array<{ value: FundingIndicatorTimeframe; label: string }> = [
  { value: '5m', label: '5m' }, { value: '15m', label: '15m' }, { value: '30m', label: '30m' },
  { value: '1h', label: '1h' }, { value: '4h', label: '4h' }, { value: '24h', label: '1D' },
];
const WINDOWS: FundingIndicatorWindow[] = ['1d', '7d', '30d'];
const METHOD_LABELS: Record<FundingIndicatorMethod, string> = { mean: 'Simple mean', median: 'Median', weighted: 'OI-weighted' };

function formatRate(value: number | null | undefined, signed = true) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${signed && value > 0 ? '+' : ''}${value.toFixed(4)}%`;
}
function tone(value: number | null | undefined) {
  return value === null || value === undefined || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative';
}
function formatOi(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}
function formatTime(value: string | null) {
  if (!value) return 'Waiting for first quote';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Update time unavailable' : `Updated ${new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date)} UTC`;
}

export function AggregatedFundingIndicator({ asset: sharedAsset }: { asset?: string } = {}) {
  const [assetDraft, setAssetDraft] = useState(sharedAsset ?? 'BTC');
  const [asset, setAsset] = useState(normalizeFundingAsset(sharedAsset ?? 'BTC'));
  const [timeframe, setTimeframe] = useState<FundingIndicatorTimeframe>('1h');
  const [window, setWindow] = useState<FundingIndicatorWindow>('7d');
  const [method, setMethod] = useState<FundingIndicatorMethod>('mean');
  const [chartMode, setChartMode] = useState<'settled' | 'recordedLive'>('settled');
  const [threshold, setThreshold] = useState(0.08);
  useEffect(() => {
    if (sharedAsset) {
      const normalized = normalizeFundingAsset(sharedAsset);
      setAsset(normalized);
      setAssetDraft(normalized);
    }
  }, [sharedAsset]);
  const feed = useFundingIndicator(asset, timeframe, window);
  const payloadMatches = !!feed.payload && normalizeFundingAsset(feed.payload.asset) === asset &&
    feed.payload.timeframe === timeframe && feed.payload.historyWindow === window;
  const payload = payloadMatches ? feed.payload : null;
  const currentValue = payload
    ? method === 'mean' ? payload.current.meanPct
      : method === 'median' ? payload.current.medianPct : payload.current.weightedPct
    : null;
  const weightedFallback = method === 'weighted' && !!payload?.current.weightedFallback;
  const isThresholdHit = currentValue !== null && currentValue !== undefined && Math.abs(currentValue) >= threshold;
  const sources = payload?.sources ?? [];
  const hasOpenInterest = sources.some((source) => source.oiUsd !== null);
  const plotMode = method === 'weighted' ? 'recordedLive' : chartMode;
  const plotSeries = method === 'mean' ? 'meanPct' : method === 'median' ? 'medianPct' : 'weightedPct';
  const chartPoints = useMemo<FundingIndicatorPoint[]>(() => {
    const points = plotMode === 'settled' ? payload?.history.points : payload?.observations.points;
    return points ?? [];
  }, [payload, plotMode]);
  const chartHasValues = chartPoints.some((point) => point[plotSeries] !== null && point[plotSeries] !== undefined);
  const settledCount = payload?.history.points.length ?? 0;
  const liveCount = payload?.observations.points.length ?? 0;
  const statusCount = sources.filter((source) => source.status === 'ok' && !feed.stale).length;
  const contributingNames = sources.filter((source) => source.status === 'ok').map((source) => source.label);
  const activePayloadTime = payload?.generatedAt ?? null;

  const applyAsset = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeFundingAsset(assetDraft);
    if (!normalized) return;
    setAsset(normalized);
    setAssetDraft(normalized);
  };
  const setMethodValue = (next: FundingIndicatorMethod) => {
    setMethod(next);
    if (next === 'weighted') setChartMode('recordedLive');
  };

  return (
    <section className="funding-indicator" aria-label="Aggregated Funding Rate indicator">
      <div className="funding-indicator-head">
        <div className="funding-indicator-title">
          <span className="funding-indicator-mark" aria-hidden="true">ƒ8</span>
          <div><h2>Aggregated Funding Rate</h2><p>Normalized 8-hour carry · live venue aggregation</p></div>
        </div>
        <span className={`funding-indicator-live${feed.stale ? ' is-stale' : payload?.isRefreshing || feed.loading && !payload ? ' is-waiting' : ''}`}
          title={feed.stale ? 'Showing cached quotes; latest refresh failed, so source freshness is unverified.' : undefined}
          aria-label={feed.stale ? `Cached snapshot, ${statusCount} feeds not verified fresh` : undefined}>
          <i aria-hidden="true" />{feed.stale ? 'Cached snapshot' : payload?.isRefreshing ? 'Refreshing venues' : feed.loading && !payload ? 'Connecting to venues' : `${statusCount} live sources`}
        </span>
      </div>

      <div className="funding-indicator-toolbar">
        <div className="funding-indicator-market">
          {!sharedAsset && <form className="funding-indicator-symbol-form" onSubmit={applyAsset}>
              <label className="super-chart-control"><span>Perpetual asset</span>
                <input value={assetDraft} onChange={(event) => setAssetDraft(event.target.value)}
                  aria-label="Funding asset" autoCapitalize="characters" spellCheck={false} placeholder="BTC" />
              </label>
              <button type="submit" className="funding-indicator-apply">Apply</button>
            </form>}
          <label className="super-chart-control"><span>Calculation</span>
            <select value={method} onChange={(event) => setMethodValue(event.target.value as FundingIndicatorMethod)} aria-label="Funding calculation">
              <option value="mean">Simple mean</option><option value="median">Median</option><option value="weighted">OI-weighted</option>
            </select>
          </label>
        </div>
        <div className="funding-indicator-options">
          <label className="super-chart-control"><span>Resolution</span>
            <select value={timeframe} onChange={(event) => setTimeframe(event.target.value as FundingIndicatorTimeframe)} aria-label="Funding chart timeframe">
              {TIMEFRAMES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="super-chart-control"><span>History window</span>
            <select value={window} onChange={(event) => setWindow(event.target.value as FundingIndicatorWindow)} aria-label="Funding history window">
              {WINDOWS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className={`funding-indicator-summary ${tone(currentValue)}${isThresholdHit ? ' is-threshold' : ''}`}>
        <div className="funding-indicator-snapshot">
          <div>
            <div className="funding-indicator-method-tag">Current {METHOD_LABELS[method]} · {asset}</div>
            <div className={`funding-indicator-value ${tone(currentValue)}`}>{formatRate(currentValue)}</div>
          </div>
          <div className="funding-indicator-snapshot-meta">
            <span><b>{payload?.current.sourceCount ?? 0}</b> contributing venues</span>
            <span>{formatTime(activePayloadTime)}</span>
            {weightedFallback && <span>OI unavailable · using simple mean fallback</span>}
          </div>
        </div>
        <div className="funding-indicator-threshold">
          <label>Neutral band
            <span><input type="number" min="0" step="0.01" value={threshold}
              aria-label="Neutral threshold percent"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 0) setThreshold(value);
              }} /> %</span>
          </label>
          <small>{isThresholdHit ? 'Outside neutral band' : `Neutral within ±${threshold.toFixed(2)}%`}</small>
        </div>
      </div>

      {(feed.error || feed.stale || payload?.isRefreshing || payload?.current.sourceCount === 0 || !payload) && (
        <div className={`funding-indicator-status${feed.error ? ' is-error' : ''}`} role="status">
          <span>{feed.error
            ? `${feed.stale && payload ? 'Showing cached values. ' : ''}${feed.error}`
            : feed.stale && payload ? 'The latest refresh failed; displaying the cached snapshot and history.'
            : payload?.isRefreshing ? 'Venue refresh in progress; available quotes remain visible.'
              : 'Feed is warming up. No verified venue quotes are available yet.'}</span>
          <button type="button" className="funding-indicator-retry" onClick={feed.refresh} disabled={feed.loading}>
            <RefreshCw size={12} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      <div className="funding-indicator-chart-tools">
        <div className="super-chart-timeframes" role="group" aria-label="Funding history mode">
          <button type="button" className={plotMode === 'settled' ? 'active' : ''} aria-pressed={plotMode === 'settled'}
            disabled={method === 'weighted'} onClick={() => setChartMode('settled')}>Settled history</button>
          <button type="button" className={plotMode === 'recordedLive' ? 'active' : ''} aria-pressed={plotMode === 'recordedLive'}
            onClick={() => setChartMode('recordedLive')}>Recorded live</button>
        </div>
        <span>{plotMode === 'settled' ? `${settledCount} settled intervals · ${payload?.history.sourcesReady ?? 0} history-ready venues` : `${liveCount} captured observations · tracker session`}</span>
      </div>

      {chartHasValues ? (
        <FundingIndicatorChart key={`${payload?.asset}:${timeframe}:${window}:${plotMode}`}
          points={chartPoints} seriesKey={plotSeries} thresholdPct={threshold} />
      ) : (
        <div className={`funding-indicator-chart-empty${feed.loading && !payload ? ' is-loading' : ''}`} role="status">
          <strong>{feed.loading && !payload ? 'Connecting to funding feeds' : 'No chart observations yet'}</strong>
          <span>{plotMode === 'settled'
            ? payload?.history.isLoading ? 'Settled payment history is still loading from verified venues.' : 'Settled history is not available for this asset and window. Current quotes and venue status remain above.'
            : 'Recorded live points appear after the tracker captures live quotes. A current quote is never used to fabricate earlier observations.'}</span>
        </div>
      )}

      <div className="funding-indicator-source-wrap">
        <div className="funding-indicator-source-head">
          <h3>Per-exchange current rates</h3>
          <span>{payload ? feed.stale ? `${sources.filter((source) => source.status === 'ok').length} cached · freshness unverified` : `${statusCount} / ${sources.length} verified feeds active` : 'Awaiting verified feed inventory'}</span>
        </div>
        <div className="funding-indicator-table-wrap">
          <table className="funding-indicator-table">
            <thead><tr><th scope="col">Exchange</th><th scope="col">Rate (% normalized 8h)</th>{hasOpenInterest && <th scope="col">OI ($)</th>}<th scope="col">History</th><th scope="col">Feed</th></tr></thead>
            <tbody>
              {sources.map((source) => {
                const nonEightHour = source.intervalHours !== null && source.intervalHours !== 8;
                const historyCopy = source.historyStatus === 'ready' ? 'Ready'
                  : source.historyStatus === 'partial' ? 'Partial'
                    : source.historyStatus === 'loading' ? 'Loading' : 'Unavailable';
                return (
                  <tr key={source.exchange}>
                    <td><div className="funding-indicator-venue"><ExchangeLogo exchange={source.exchange} /><span>{source.label}</span></div>
                      {source.symbol && <small className="funding-indicator-contract" title={source.fetchedAt ? `Last received ${source.fetchedAt}` : undefined}>{source.symbol}</small>}
                    </td>
                    <td className={`funding-indicator-rate ${tone(source.ratePct)}${source.ratePct !== null && Math.abs(source.ratePct) >= threshold ? ' is-threshold' : ''}`}>
                      {formatRate(source.ratePct, false)}
                      {nonEightHour && <small title="Venue quotes on this native settlement interval are normalized to an 8-hour rate."> · {source.intervalHours}h native {formatRate(source.nativeRatePct, false)}</small>}
                    </td>
                    {hasOpenInterest && <td>{formatOi(source.oiUsd)}</td>}
                    <td title={source.historyNote || undefined}>{historyCopy}</td>
                    <td><span className={`funding-indicator-status-pill${source.status === 'ok' && !feed.stale ? ' is-ok' : ''}${source.status === 'ok' && feed.stale ? ' is-stale' : ''}`}
                      title={feed.stale && source.status === 'ok' ? 'Cached quote; freshness is unverified after the latest feed error.' : undefined}
                      aria-label={feed.stale && source.status === 'ok' ? `${source.label} cached quote, freshness unverified` : undefined}>
                      <i aria-hidden="true" />{source.status === 'ok' ? feed.stale ? 'Cached' : 'Live' : source.status === 'loading' ? 'Loading' : 'Unavailable'}
                    </span></td>
                  </tr>
                );
              })}
              {!sources.length && <tr><td colSpan={hasOpenInterest ? 5 : 4}>Venue inventory will appear as feed discovery completes.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="funding-indicator-method-note">
        <i aria-hidden="true">i</i>
        <p>{method === 'weighted'
          ? <><b>OI-weighted view uses recorded live observations only.</b> Historical settlements are never weighted with today’s open interest. If a live snapshot has no usable OI, the snapshot falls back to the simple mean.</>
          : <><b>Settled points are effective 8-hour rates from actual funding payments.</b> Historical mean and median are computed from settled venue history; historical open-interest weights are not available or applied.</>}
          {' '}Recorded observations are captured only while this tracker is active; the local bounded cache is not guaranteed to persist across sessions. Venue coverage varies.
          {sources.some((source) => source.intervalHours !== null && source.intervalHours !== 8) && ' Native intervals shown above are informational; all displayed rates use the normalized 8-hour basis.'}
        </p>
      </div>
      <p className="funding-indicator-footnote">Rates are expressed in percent per normalized 8-hour interval. Positive funding means longs pay shorts; red indicates positive, green negative. Each venue uses its highest-OI verified perpetual contract for this coin, with USD OI weights. Settled rates infer payment frequency from consecutive recorded payments; unknown gaps are excluded, not zero-filled. {contributingNames.length ? `${feed.stale ? 'Last-known contributors' : 'Current contributors'}: ${contributingNames.join(', ')}.` : 'Missing venues are excluded, never treated as zero.'}</p>
    </section>
  );
}
