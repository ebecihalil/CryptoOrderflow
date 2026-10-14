import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RefreshCw, RotateCw } from 'lucide-react';
import { NativeSuperChart } from '@/components/native-super-chart';
import { ExchangeLogo } from '@/components/exchange-logo';
import { useLiquidityCandles, type LiquidityExchange, type LiquidityTimeframe, type LiquidityVolumeMode } from '@/hooks/use-liquidity-candles';
import {
  normalizeFundingAsset, useFundingIndicator, type FundingIndicatorMethod, type FundingIndicatorTimeframe,
  type FundingIndicatorWindow, type FundingIndicatorPoint,
} from '@/hooks/use-funding-indicator';
import { useCvdIndicator, type CvdAnchor, type CvdMarket, type CvdPayload } from '@/hooks/use-cvd-indicator';
import { calculateLiquidityZones, type Candle, type LiquiditySettings } from '@/lib/liquidity-zones';
import type { MarketContract } from '@/hooks/use-market-contracts';
import type { ChartStudyId } from '@/lib/supercharts';
import { DEFAULT_TECHNICAL_SETTINGS, type TechnicalSettings } from '@/lib/technical-indicators';
import '@/styles/native-super-chart.css';

type OrderflowId = 'liquidity' | 'funding' | 'perpetual-cvd' | 'spot-cvd';
type Props = { contract: MarketContract | null; studies: ChartStudyId[]; indicators: OrderflowId[] };
type ThemeColors = { resistance: string; support: string; inside: string; transparency: number };
const FRAMES: Array<{ value: LiquidityTimeframe; label: string }> = [
  { value: '5m', label: '5m' }, { value: '15m', label: '15m' }, { value: '30m', label: '30m' },
  { value: '1h', label: '1h' }, { value: '4h', label: '4h' }, { value: '24h', label: '1D' },
];
const EXCHANGES = new Set<LiquidityExchange>(['binance', 'gate', 'okx', 'bybit', 'mexc', 'bitget', 'bingx']);
const DEFAULT_LIQUIDITY_SETTINGS: LiquiditySettings = { backBars: 300, volMult: 1.2 };
const DEFAULT_ZONE_COLORS: ThemeColors = { resistance: '#ff0000', support: '#008000', inside: '#808080', transparency: 35 };
const METHOD_NAMES: Record<FundingIndicatorMethod, string> = { mean: 'Simple mean', median: 'Median', weighted: 'OI-weighted' };
const EMPTY_CANDLES: Candle[] = [];
const CVD_ANCHORS: Array<{ value: CvdAnchor; label: string }> = [
  { value: '1d', label: '1D' }, { value: '1w', label: '1W' }, { value: '1m', label: '1M' },
  { value: '3m', label: '3M' }, { value: '6m', label: '6M' }, { value: '1y', label: '1Y' },
];

function fmtTime(time: number) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(time * 1000)) + ' UTC';
}
function fmtPct(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(4)}%`;
}
function fmtOi(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'OI —';
  if (value >= 1_000_000_000) return `OI $${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `OI $${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `OI $${(value / 1_000).toFixed(0)}K`;
  return `OI $${value.toFixed(0)}`;
}
function timeframeSeconds(timeframe: LiquidityTimeframe) {
  return ({ '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '24h': 86400 } as const)[timeframe];
}
function contiguousTail(candles: Candle[], timeframe: LiquidityTimeframe) {
  if (candles.length < 2) return candles;
  const step = timeframeSeconds(timeframe);
  let start = candles.length - 1;
  while (start > 0 && candles[start].time - candles[start - 1].time === step) start--;
  return candles.slice(start);
}

export function NativeChartWorkspace(props: Props) {
  if (!props.contract) {
    return <section className="native-workspace native-awaiting-market" aria-live="polite">
      <span className="module-kicker">LIVE CONTRACT CATALOGUE</span>
      <strong>{'Choose a verified perpetual contract to load venue candles.'}</strong>
      <p>Chart feeds are not requested for symbols outside the verified catalogue.</p>
    </section>;
  }
  return <WorkspaceWithContract contract={props.contract} studies={props.studies} indicators={props.indicators} />;
}

function WorkspaceWithContract({ contract, studies, indicators }: Props & { contract: MarketContract }) {
  const [timeframe, setTimeframe] = useState<LiquidityTimeframe>('1h');
  const [volumeBasis, setVolumeBasis] = useState<LiquidityVolumeMode>('aggregated');
  const [showVolume, setShowVolume] = useState(true);
  const [technicalSettings, setTechnicalSettings] = useState<TechnicalSettings>({ ...DEFAULT_TECHNICAL_SETTINGS });
  const [liquiditySettings, setLiquiditySettings] = useState(DEFAULT_LIQUIDITY_SETTINGS);
  const [zoneColors, setZoneColors] = useState(DEFAULT_ZONE_COLORS);
  const hasLiquidity = indicators.includes('liquidity');
  const hasFunding = indicators.includes('funding');
  const hasPerpetualCvd = indicators.includes('perpetual-cvd');
  const hasSpotCvd = indicators.includes('spot-cvd');
  const exchange = EXCHANGES.has(contract.exchange.toLowerCase() as LiquidityExchange)
    ? contract.exchange.toLowerCase() as LiquidityExchange : 'binance';
  const nativeSymbol = contract.symbol;
  const nativeFeed = useLiquidityCandles(exchange, nativeSymbol, timeframe, 'single');
  const aggregateRequested = volumeBasis === 'aggregated' && (showVolume || hasLiquidity);
  const aggregateFeed = useLiquidityCandles(exchange, nativeSymbol, timeframe, 'aggregated', aggregateRequested);
  const nativePayloadCurrent = !!nativeFeed.payload && nativeFeed.payload.exchange === exchange &&
    nativeFeed.payload.symbol === nativeSymbol && nativeFeed.payload.timeframe === timeframe &&
    (nativeFeed.payload.volumeMode === 'single' || nativeFeed.payload.volumeMode === undefined);
  const aggregatePayloadCurrent = !!aggregateFeed.payload && aggregateFeed.payload.exchange === exchange &&
    aggregateFeed.payload.symbol === nativeSymbol && aggregateFeed.payload.timeframe === timeframe &&
    aggregateFeed.payload.volumeMode === 'aggregated';
  const candles = nativePayloadCurrent ? nativeFeed.payload!.candles : EMPTY_CANDLES;
  const aggregateVolumes = useMemo(() => {
    if (!nativePayloadCurrent || !aggregatePayloadCurrent) return [] as Candle[];
    const byTime = new Map<number, Candle>();
    for (const row of aggregateFeed.payload!.candles) {
      if (Number.isFinite(row.volume) && row.volume >= 0) byTime.set(row.time, row);
    }
    return candles.filter((bar) => byTime.has(bar.time)).map((bar) => ({
      ...bar,
      volume: byTime.get(bar.time)!.volume,
    }));
  }, [nativePayloadCurrent, aggregatePayloadCurrent, aggregateFeed.payload, candles]);
  const selectedVolumeCandles = volumeBasis === 'single' ? candles : aggregateVolumes;
  const liquidityCandles = volumeBasis === 'single' ? candles : contiguousTail(aggregateVolumes, timeframe);
  const liquidity = useMemo(() => calculateLiquidityZones(liquidityCandles, liquiditySettings), [liquidityCandles, liquiditySettings]);
  const current = candles.at(-1);
  const [fundingWindow, setFundingWindow] = useState<FundingIndicatorWindow>('7d');
  const [fundingMethod, setFundingMethod] = useState<FundingIndicatorMethod>('mean');
  const [fundingMode, setFundingMode] = useState<'settled' | 'recordedLive'>('settled');
  const [fundingThreshold, setFundingThreshold] = useState(0.08);
  const [perpetualAnchor, setPerpetualAnchor] = useState<CvdAnchor>('1w');
  const [spotAnchor, setSpotAnchor] = useState<CvdAnchor>('1w');
  const canonicalAsset = contract.asset.toUpperCase();
  const perpetualCvd = useCvdIndicator(canonicalAsset, 'perpetual', timeframe, perpetualAnchor, hasPerpetualCvd);
  const spotCvd = useCvdIndicator(canonicalAsset, 'spot', timeframe, spotAnchor, hasSpotCvd);

  const cvdControls = (market: CvdMarket, enabled: boolean, anchor: CvdAnchor, setAnchor: (value: CvdAnchor) => void,
    feed: ReturnType<typeof useCvdIndicator>) => {
    if (!enabled) return null;
    const payload = feed.payload && feed.payload.asset.toUpperCase() === canonicalAsset &&
      feed.payload.market === market && feed.payload.timeframe === timeframe && feed.payload.anchor === anchor
      ? feed.payload : null;
    const marketLabel = market === 'spot' ? 'Spot CVD' : 'Perpetual CVD';
    const activeSourceCount = payload?.sources.filter((source) => source.status === 'live').length ?? 0;
    const tradeCount = payload?.candles.reduce((sum, candle) => sum + candle.trades, 0) ?? 0;
    const recordedSources = payload?.candles.reduce((maximum, candle) => Math.max(maximum, candle.sourceCount), 0) ?? 0;
    const actualStart = payload?.historyStart ? new Date(payload.historyStart).toLocaleString() : null;
    return <section className="native-cvd-controls" key={market} aria-label={`${marketLabel} controls`}>
      <div className="native-cvd-heading">
        <div><span className="module-kicker">SIGNED EXECUTED FLOW / USD-EQUIVALENT</span><h2>{marketLabel}</h2></div>
        <span className="native-cvd-source-total">{activeSourceCount}/{payload?.sources.length ?? 10} live venues · up to {recordedSources} per bar</span>
      </div>
      <div className="native-cvd-control-row">
        <div className="native-cvd-anchors" role="group" aria-label={`${marketLabel} anchor period`}>
          <span>Anchor</span>{CVD_ANCHORS.map((item) => <button key={item.value} type="button"
            className={anchor === item.value ? 'active' : ''} aria-pressed={anchor === item.value}
            onClick={() => setAnchor(item.value)}>{item.label}</button>)}
        </div>
        <span className="native-cvd-count">{payload ? `${tradeCount.toLocaleString()} trades · ${payload.candles.length.toLocaleString()} bars` : 'Awaiting recorded trades'}</span>
        <button type="button" className="native-tool-button" onClick={feed.refresh} disabled={feed.loading}>
          <RefreshCw size={12} aria-hidden="true" /> Refresh
        </button>
      </div>
      {feed.loading && !payload && <p className="native-cvd-status" role="status">Loading recorded {market} trade history…</p>}
      {feed.error && <div className="native-cvd-status is-error" role="alert">
        <span>{payload ? `Refresh issue: ${feed.error} Cached recorded candles remain visible.` : feed.error}</span>
        <button type="button" onClick={feed.refresh}>Retry</button>
      </div>}
      {payload && <>
        <div className="native-cvd-history" role="status">
          <span>{actualStart ? `Actual history starts ${actualStart}` : 'No recorded history start yet'}</span>
          <span>{payload.completeAnchor ? 'Anchor history complete' : `Partial anchor · recording began ${new Date(payload.recordingStartedAt).toLocaleString()}`}</span>
          {payload.candles.length === 0 && <span>No trades recorded for this market and interval.</span>}
        </div>
        <div className="native-cvd-sources" aria-label={`${marketLabel} venue status`}>
          {payload.sources.map((source) => <span key={source.exchange} className={`status-${source.status}`}
            title={[source.symbol, source.lastTradeAt ? `Last trade ${source.lastTradeAt}` : null].filter(Boolean).join(' · ') || source.status}>
            <i aria-hidden="true" />{source.exchange.toUpperCase()} · {source.status.replace('_', ' ')}
          </span>)}
        </div>
        <details className="native-cvd-method"><summary>Method &amp; coverage notes</summary>
          {payload.warnings.map((warning, index) => <p className="native-cvd-warning" key={`${index}-${warning}`}>{warning}</p>)}
        </details>
      </>}
      <p className="native-cvd-method">CVD is the signed USD-equivalent value of executed buys minus sells—not open-interest weighted. Only recorded trade history is shown; gaps and pre-recording history are not filled.</p>
      {!feed.loading && !feed.error && !payload && <p className="native-cvd-status" role="status">No recorded {market} history is available yet.</p>}
    </section>;
  };

  const frameButtons = <div className="super-chart-timeframes" role="group" aria-label="Chart timeframe">
    {FRAMES.map((frame) => <button key={frame.value} type="button" className={timeframe === frame.value ? 'active' : ''}
      aria-pressed={timeframe === frame.value} onClick={() => setTimeframe(frame.value)}>{frame.label}</button>)}
  </div>;
  const settingsPanel = hasLiquidity && <section className="native-indicator-controls" aria-label="Liquidity zones controls">
    <div className="native-section-label"><span className="module-kicker">EXCHANGE VOLUME QUALIFIER</span><b>Liquidity Zones</b></div>
    <label className="liquidity-range-control"><span><b>Bars to apply</b><output>{liquiditySettings.backBars} bars</output></span>
      <input type="range" min="50" max="900" value={liquiditySettings.backBars}
        onChange={(event) => setLiquiditySettings((value) => ({ ...value, backBars: Number(event.target.value) }))} /></label>
    <label className="liquidity-range-control"><span><b>Volume sensitivity</b><output>{liquiditySettings.volMult.toFixed(1)}× average</output></span>
      <input type="number" min="0.1" step="0.1" value={liquiditySettings.volMult} aria-label="Liquidity volume sensitivity"
        onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0.1) setLiquiditySettings((current) => ({ ...current, volMult: value })); }} /></label>
    <div className="native-color-controls">
      {(['resistance', 'support', 'inside'] as const).map((key) => <label key={key}><span>{key}</span><input type="color" value={zoneColors[key]}
        aria-label={`${key} zone color`} onChange={(event) => setZoneColors((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
    </div>
    <label className="liquidity-range-control"><span><b>Fill transparency</b><output>{zoneColors.transparency}%</output></span>
      <input type="range" min="0" max="100" value={zoneColors.transparency}
        onChange={(event) => setZoneColors((current) => ({ ...current, transparency: Number(event.target.value) }))} /></label>
    <p className="native-hint">Pivots confirm 10 bars after the swing; ATR and volume need warmup history. Available history varies by venue and resolution (some feeds return about 300 bars), so short history can omit zones. Current usable {volumeBasis === 'aggregated' ? 'contiguous aggregate-volume' : 'native-volume'} history: {liquidityCandles.length} bars; scan {liquiditySettings.backBars} + 30 warmup.</p>
  </section>;
  const technicalControls = studies.length > 0 && <section className="native-tech-controls" aria-label="Technical indicator periods">
    <div className="native-section-label"><span className="module-kicker">PRICE STUDIES / SETTINGS</span><b>Study parameters</b></div>
    {studies.includes('ema') && <PeriodControl label="EMA period" value={technicalSettings.emaPeriod}
      onChange={(value) => setTechnicalSettings((current) => ({ ...current, emaPeriod: value }))} />}
    {studies.includes('sma') && <PeriodControl label="SMA period" value={technicalSettings.smaPeriod}
      onChange={(value) => setTechnicalSettings((current) => ({ ...current, smaPeriod: value }))} />}
    {studies.includes('bb') && <>
      <PeriodControl label="Bollinger period" value={technicalSettings.bbPeriod}
        onChange={(value) => setTechnicalSettings((current) => ({ ...current, bbPeriod: value }))} />
      <label className="super-chart-control"><span>Deviation</span><input type="number" min="0.1" max="10" step="0.1"
        value={technicalSettings.bbStdDev} onChange={(event) => { const n = Number(event.target.value); if (Number.isFinite(n) && n > 0 && n <= 10) setTechnicalSettings((current) => ({ ...current, bbStdDev: n })); }} /></label>
    </>}
    {studies.includes('rsi') && <PeriodControl label="RSI period" value={technicalSettings.rsiPeriod}
      onChange={(value) => setTechnicalSettings((current) => ({ ...current, rsiPeriod: value }))} />}
    {studies.includes('macd') && <>
      <PeriodControl label="MACD fast" value={technicalSettings.macdFast}
        onChange={(value) => {
          if (value >= technicalSettings.macdSlow) {
            return `Fast period must be smaller than slow (${technicalSettings.macdSlow}).`;
          }
          setTechnicalSettings((current) => ({ ...current, macdFast: value }));
        }} />
      <PeriodControl label="MACD slow" value={technicalSettings.macdSlow}
        onChange={(value) => {
          if (value <= technicalSettings.macdFast) {
            return `Slow period must be larger than fast (${technicalSettings.macdFast}).`;
          }
          setTechnicalSettings((current) => ({ ...current, macdSlow: value }));
        }} />
      <PeriodControl label="MACD signal" value={technicalSettings.macdSignal}
        onChange={(value) => setTechnicalSettings((current) => ({ ...current, macdSignal: value }))} />
    </>}
    {studies.includes('macd') && <small>Fast period must remain below slow. Periods: 2–500.</small>}
  </section>;

  const chartAndDetails = (funding: FundingPlotData | null) => (
    <>
      <div className="native-chart-toolbar">
        {frameButtons}
        <label className="super-chart-control"><span>Volume basis</span><select value={volumeBasis}
          onChange={(event) => setVolumeBasis(event.target.value as LiquidityVolumeMode)} aria-label="Chart volume basis">
          <option value="single">Selected venue</option><option value="aggregated">Aggregated · 4 venues</option>
        </select></label>
        <label className="native-volume-toggle"><input type="checkbox" checked={showVolume}
          onChange={(event) => setShowVolume(event.target.checked)} /> Volume pane</label>
        <button type="button" className="native-tool-button" onClick={() => {
          nativeFeed.refresh();
          if (aggregateRequested) aggregateFeed.refresh();
        }} disabled={nativeFeed.loading || aggregateRequested && aggregateFeed.loading}>
          <RefreshCw size={13} aria-hidden="true" /> Refresh data
        </button>
      </div>
      <div className="native-feed-meta" role="status">
        <span className={nativePayloadCurrent && !nativeFeed.payload?.stale ? 'is-live' : ''}><i aria-hidden="true" />{nativePayloadCurrent
          ? nativeFeed.payload!.stale ? 'Cached native OHLC snapshot' : `${exchange.toUpperCase()} native OHLC snapshot`
          : nativeFeed.loading ? 'Loading native OHLC' : 'Native OHLC unavailable'}</span>
        {nativePayloadCurrent && <span>{candles.length.toLocaleString()} native price bars</span>}
        {nativePayloadCurrent && <span>Fetched {new Date(nativeFeed.payload!.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        {(nativeFeed.error || nativePayloadCurrent && nativeFeed.payload?.error) && <span className="is-warning">{nativeFeed.error ?? nativeFeed.payload?.error}</span>}
        <span className="native-native-symbol">Native {contract.symbol}{contract.priceDivisor !== 1 ? ` · ×${contract.priceDivisor} contract` : ''}</span>
      </div>
      <div className="native-volume-meta" role="status">
        <span className="native-volume-basis-label">VOLUME · {volumeBasis === 'aggregated' ? 'AGGREGATED FOUR-VENUE' : 'SELECTED NATIVE VENUE'}</span>
        {volumeBasis === 'single' ? <>
          <span>{nativePayloadCurrent ? `${candles.length} native volume bars · ${contract.exchangeAsset}` : nativeFeed.loading ? 'Waiting for native volume' : 'Native volume unavailable'}</span>
          {nativePayloadCurrent && nativeFeed.payload?.stale && <span className="is-warning">Cached volume · freshness unverified</span>}
        </> : !aggregateRequested
          ? <span>Aggregation idle · enable Volume pane or Liquidity Zones to request matched venue volume.</span>
          : <>
            <span>{aggregatePayloadCurrent ? `${aggregateVolumes.length} exact timestamp matches · ${aggregateFeed.payload?.volumeAsset ?? contract.exchangeAsset}` :
              aggregateFeed.loading ? 'Loading matched volume sources' : 'No matching aggregated-volume payload'}</span>
            <span>{aggregatePayloadCurrent ? `${aggregateFeed.payload?.matchedCandleCount ?? aggregateVolumes.length} server-aligned bars · ${aggregateFeed.payload?.volumeSources?.filter((s) => s.status === 'ok').length ?? 0}/4 sources`
              : 'Aggregation is separate from selected-venue price OHLC.'}</span>
            {aggregatePayloadCurrent && <span className={aggregateFeed.payload?.stale ? 'is-warning' : ''}>
              {aggregateFeed.payload?.stale ? 'Cached volume · freshness unverified' : 'Aggregate volume snapshot'}
              {aggregateFeed.payload?.partialVolume ? ' · partial coverage' : ''}</span>}
            {aggregatePayloadCurrent && <span className="native-volume-sources">{(aggregateFeed.payload?.volumeSources ?? []).map((source) =>
              <span key={source.exchange} className={source.status === 'ok' && !aggregateFeed.payload?.stale ? 'is-live' : ''}>
                <i />{source.exchange.toUpperCase()} · {source.status === 'ok' ? aggregateFeed.payload?.stale ? 'cached' : `${source.matchedBars} bars` : 'unavailable'}</span>)}</span>}
            {(aggregateFeed.error || aggregatePayloadCurrent && aggregateFeed.payload?.error) && <span className="is-warning">
              {aggregateFeed.error ?? aggregateFeed.payload?.error}</span>}
          </>}
      </div>
      {nativeFeed.loading && !nativePayloadCurrent ? <div className="native-chart-skeleton" aria-label="Loading exchange candles"><i /><i /><i /><i /><i /></div>
        : candles.length ? <NativeSuperChart candles={candles} volumeCandles={selectedVolumeCandles} studies={studies} zones={hasLiquidity ? liquidity.zones : []}
          liquiditySettings={liquiditySettings} zoneColors={zoneColors} funding={funding} showVolume={showVolume} timeframe={timeframe}
           resetKey={`${contract?.label ?? ''}:${timeframe}`} technicalSettings={technicalSettings}
           perpetualCvd={hasPerpetualCvd ? perpetualCvd.payload : null} spotCvd={hasSpotCvd ? spotCvd.payload : null}
           perpetualCvdEnabled={hasPerpetualCvd} spotCvdEnabled={hasSpotCvd} />
          : <div className="native-chart-error" role="alert"><strong>{nativeFeed.error ? 'Native exchange feed unavailable' : 'No matching native candle history'}</strong>
            <span>{nativeFeed.error ?? 'The selected native contract has no candle history for this resolution.'}</span>
            <button type="button" onClick={nativeFeed.refresh}><RotateCw size={13} /> Retry price feed</button></div>}
      {nativePayloadCurrent && nativeFeed.payload?.stale && <p className="native-data-warning">
        Cached native OHLC snapshot; live price freshness is unverified.
      </p>}
      {volumeBasis === 'aggregated' && aggregateRequested && (aggregateFeed.error || aggregatePayloadCurrent && (aggregateFeed.payload?.stale || aggregateFeed.payload?.partialVolume)) &&
        <p className="native-volume-warning">{aggregateFeed.error ? `Volume feed: ${aggregateFeed.error}` : aggregateFeed.payload?.stale
          ? 'Aggregated volume is cached; its freshness is unverified.' : 'Aggregated volume coverage is partial. Missing sources and unmatched timestamps are excluded, never treated as zero.'}
      </p>}
      {settingsPanel}
      {technicalControls}
      {cvdControls('perpetual', hasPerpetualCvd, perpetualAnchor, setPerpetualAnchor, perpetualCvd)}
      {cvdControls('spot', hasSpotCvd, spotAnchor, setSpotAnchor, spotCvd)}
      {hasLiquidity && volumeBasis === 'aggregated' && aggregateRequested && !aggregatePayloadCurrent && <p className="native-volume-warning" role="status">
        Liquidity Zones are waiting for a matching aggregate-volume feed. Native price/technical candles remain available; zones are not calculated with substitute venue volume.
      </p>}
      {hasLiquidity && volumeBasis === 'aggregated' && aggregatePayloadCurrent && liquidityCandles.length < liquiditySettings.backBars + 30 && <p className="native-volume-warning" role="status">
        Only {liquidityCandles.length} consecutive matched-volume bars are available for Liquidity Zones; {liquiditySettings.backBars + 30} bars are recommended for the scan and warmup. The calculation uses the contiguous matched suffix only.
      </p>}
      {hasLiquidity && <section className="native-signals">
        <div><span className="module-kicker">QUALIFIED ZONES</span><b>{liquidity.zones.length}</b><small>{liquidity.signals.length} signals in visible feed history</small></div>
        <ul>{[...liquidity.signals].sort((a, b) => b.time - a.time).slice(0, 5).map((signal, index) =>
          <li key={`${signal.time}-${signal.type}-${index}`}><i className={signal.type} /><b>{signal.type === 'breakout' ? 'Breakout' : 'Touch'}</b>
            <span>{signal.zoneIds.length} zone{signal.zoneIds.length === 1 ? '' : 's'}</span><time>{fmtTime(signal.time)}</time>{!signal.closed && <em>Provisional</em>}</li>)}
          {!liquidity.signals.length && <li className="native-no-signals">No zone signals in the available history.</li>}</ul>
      </section>}
      <div className="native-method-note">
        <span>i</span><p>Prices and OHLC are from the selected native exchange contract. {volumeBasis === 'aggregated'
          ? 'Volume sums exactly matched underlying-coin volume from up to four venues; it is not open-interest weighted.'
          : 'Volume is from the selected venue only.'}
          {' '}Liquidity zones use the selected volume basis. Missing volume timestamps are left unmatched, never zero-filled or replaced with selected-venue values. Funding values are verified venue observations or settled payments, normalized to an 8-hour rate; red is positive and green is negative. Missing timestamps are left as gaps. Price, volume and funding use roughly 30-second snapshot polling and exchange/server caches. CVD records public executed-trade streams and updates its chart snapshot roughly every five seconds.</p>
      </div>
    </>
  );

  return <section className="native-workspace" aria-label="Native perpetual chart workspace">
    <div className="native-symbol-strip">
      <div><span className="native-symbol-name">{contract?.asset ?? '—'}<i>PERP</i></span><span>{contract?.exchange.toUpperCase() ?? 'EXCHANGE'} · {contract?.symbol ?? 'Select a contract'}</span></div>
      <div className="native-price-summary"><strong>{current?.close.toLocaleString(undefined, { maximumSignificantDigits: 9 }) ?? '—'}</strong>
        <span>native close · {contract?.exchangeAsset ?? 'quote'}</span></div>
      <button type="button" className="native-fit-button" onClick={() => window.dispatchEvent(new Event('native-chart-fit'))}>Fit view</button>
    </div>
    <FundingEnabledWorkspace enabled={hasFunding} contract={contract} timeframe={timeframe} method={fundingMethod} setMethod={setFundingMethod}
      window={fundingWindow} setWindow={setFundingWindow} mode={fundingMode} setMode={setFundingMode}
      threshold={fundingThreshold} setThreshold={setFundingThreshold} render={chartAndDetails} />
  </section>;
}

type FundingPlotData = { points: FundingIndicatorPoint[]; method: FundingIndicatorMethod; threshold: number };
type FundingProps = {
  enabled: boolean;
  contract: MarketContract; timeframe: LiquidityTimeframe; method: FundingIndicatorMethod;
  setMethod: (value: FundingIndicatorMethod) => void; window: FundingIndicatorWindow; setWindow: (value: FundingIndicatorWindow) => void;
  mode: 'settled' | 'recordedLive'; setMode: (value: 'settled' | 'recordedLive') => void;
  threshold: number; setThreshold: (value: number) => void; render: (plot: FundingPlotData | null) => ReactNode;
};

function FundingEnabledWorkspace(props: FundingProps) {
  const asset = normalizeFundingAsset(props.contract?.asset ?? '');
  const feed = useFundingIndicator(asset || 'BTC', props.timeframe as FundingIndicatorTimeframe, props.window, props.enabled);
  const payload = props.enabled && feed.payload && normalizeFundingAsset(feed.payload.asset) === asset &&
    feed.payload.timeframe === props.timeframe && feed.payload.historyWindow === props.window ? feed.payload : null;
  const mode = props.method === 'weighted' ? 'recordedLive' : props.mode;
  const points = mode === 'settled' ? payload?.history.points ?? [] : payload?.observations.points ?? [];
  const plot: FundingPlotData = { points, method: props.method, threshold: props.threshold };
  const methodField = props.method === 'mean' ? 'meanPct' : props.method === 'median' ? 'medianPct' : 'weightedPct';
  const current = payload ? payload.current[props.method === 'mean' ? 'meanPct' : props.method === 'median' ? 'medianPct' : 'weightedPct'] : null;
  const selectedHistory = points.filter((point) => point[methodField] !== null && point[methodField] !== undefined).length;
  const liveCount = payload?.observations.points.filter((point) => point.weightedPct !== null && point.weightedPct !== undefined).length ?? 0;
  const activeSources = payload?.sources.filter((source) => source.status === 'ok').length ?? 0;

  return <>
    {props.render(props.enabled ? plot : null)}
    {props.enabled && <section className="native-funding-controls" aria-label="Aggregated funding controls">
      <div className="native-funding-head"><div><span className="module-kicker">CROWD CARRY / VERIFIED VENUES</span><h2>Aggregated funding rate</h2></div>
        <span className={`native-funding-live${feed.stale ? ' is-stale' : ''}`}><i />{feed.stale ? 'Cached snapshot' : payload?.isRefreshing ? 'Refreshing venues' : `${activeSources} live sources`}</span></div>
      <div className="native-funding-controls-row">
        <label className="super-chart-control"><span>Calculation</span><select value={props.method}
          onChange={(event) => props.setMethod(event.target.value as FundingIndicatorMethod)} aria-label="Funding calculation">
          <option value="mean">Simple mean</option><option value="median">Median</option><option value="weighted">OI-weighted</option></select></label>
        <label className="super-chart-control"><span>History window</span><select value={props.window}
          onChange={(event) => props.setWindow(event.target.value as FundingIndicatorWindow)} aria-label="Funding history window">
          <option value="1d">1 day</option><option value="7d">7 days</option><option value="30d">30 days</option></select></label>
        <label className="super-chart-control"><span>Funding plot</span><select value={mode} disabled={props.method === 'weighted'}
          onChange={(event) => props.setMode(event.target.value as 'settled' | 'recordedLive')} aria-label="Funding history type">
          <option value="settled">Settled payments</option><option value="recordedLive">Recorded live</option></select></label>
        <label className="super-chart-control"><span>Neutral threshold</span><input type="number" min="0" step="0.01" value={props.threshold} aria-label="Funding neutral threshold percent"
          onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0) props.setThreshold(value); }} /></label>
        <div className={`native-funding-current${current !== null && current > 0 ? ' positive' : current !== null && current < 0 ? ' negative' : ''}`}>
          <small>Current {METHOD_NAMES[props.method]}</small><strong>{fmtPct(current)}</strong><span>{payload?.current.sourceCount ?? 0} contributing venues</span>
        </div>
      </div>
      {(feed.error || feed.stale || feed.loading && !payload || payload?.current.sourceCount === 0) && <div className="native-funding-status" role="status">
        <span>{feed.error ? `${feed.stale && payload ? 'Cached values shown. ' : ''}${feed.error}` : feed.stale ? 'Latest refresh failed; cached data is shown.'
          : feed.loading && !payload ? 'Connecting to funding venues…' : 'No verified venue quotes are available yet.'}</span>
        <button type="button" onClick={feed.refresh} disabled={feed.loading}><RefreshCw size={12} /> Retry</button>
      </div>}
      <div className="native-funding-counts"><span>{mode === 'settled' ? `${selectedHistory} available settled observations · ${payload?.history.sourcesReady ?? 0} history-ready venues`
        : `${selectedHistory} available recorded observations · tracker session`}</span>
        <span>{liveCount} recorded observations with weighted values</span>
        <span>Resolution follows chart · {props.timeframe}</span></div>
      <div className="native-funding-venues">{(payload?.sources ?? []).map((source) =>
        <span key={source.exchange} className={source.status === 'ok' && !feed.stale ? 'is-live' : ''}
          title={[source.symbol, source.fetchedAt ? `Updated ${source.fetchedAt}` : null, source.historyNote].filter(Boolean).join(' · ') || undefined}>
          <ExchangeLogo exchange={source.exchange} />
          <span>{source.label} · {source.status === 'ok' ? feed.stale ? 'cached' : fmtPct(source.ratePct) : source.status}
            {source.intervalHours && source.intervalHours !== 8 ? ` · native ${fmtPct(source.nativeRatePct)} / ${source.intervalHours}h` : ''} · {fmtOi(source.oiUsd)}</span></span>)}
        {!payload?.sources.length && <span>Venue inventory appears when discovery completes.</span>}</div>
      <p className="native-hint">{props.method === 'weighted'
        ? `OI-weighted plots use recorded live observations only. Each weight is contemporaneous open interest; historical settled rates are never weighted with today’s OI.${payload?.current.weightedFallback ? ' The current snapshot falls back to the simple mean because usable OI is not available.' : ''}`
        : 'Settled mean and median use actual venue payment history. Rates are normalized to an 8-hour basis; no missing intervals are filled.'}
        {props.method === 'weighted' && payload && (() => {
          const fallbackCount = payload.observations.points.filter((point) => point.weightedFallback && point.weightedPct !== null && point.weightedPct !== undefined).length;
          return fallbackCount ? ` ${fallbackCount} recorded live point${fallbackCount === 1 ? '' : 's'} use the feed’s mean fallback where contemporaneous OI was unavailable.` : '';
        })()}
        {' '}Available feed points: {mode === 'settled' ? payload?.history.points.length ?? 0 : payload?.observations.points.length ?? 0}; charted points are clipped to selected price history.</p>
    </section>}
  </>;
}

function PeriodControl({ label, value, onChange }: {
  label: string; value: number; onChange: (value: number) => string | null | void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(String(value));
    setError(null);
  }, [value]);
  const commit = () => {
    if (!/^\d+$/.test(draft)) {
      setError('Enter a whole-number period from 2 to 500.');
      return;
    }
    const next = Number(draft);
    if (!Number.isInteger(next) || next < 2 || next > 500) {
      setError('Enter a whole-number period from 2 to 500.');
      return;
    }
    const validation = onChange(next);
    if (typeof validation === 'string' && validation) {
      setError(validation);
      return;
    }
    setError(null);
  };
  return <label className="super-chart-control">
    <span>{label}</span>
    <input type="number" min="2" max="500" step="1" value={draft} aria-invalid={!!error}
      aria-describedby={error ? `${label.replace(/\s+/g, '-')}-error` : undefined}
      onChange={(event) => { setDraft(event.target.value); setError(null); }}
      onBlur={commit} onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
      }} />
    {error && <small className="native-input-error" id={`${label.replace(/\s+/g, '-')}-error`} role="alert">{error}</small>}
  </label>;
}

