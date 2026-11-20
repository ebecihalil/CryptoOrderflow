import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, RotateCw } from 'lucide-react';
import { NativeSuperChart } from '@/components/native-super-chart';
import { ALL_TIMEFRAMES, isSecondTimeframe, nextBucket } from '../../server/timeframes.js';
import { TimeframePicker } from '@/components/timeframe-picker';
import { extraIndicator, extraParams } from '@/lib/extra-indicators';
import { ExchangeLogo } from '@/components/exchange-logo';
import { useLiquidityCandles, type LiquidityExchange, type LiquidityTimeframe, type LiquidityVolumeMode } from '@/hooks/use-liquidity-candles';
import {
  normalizeFundingAsset, useFundingIndicator, type FundingIndicatorMethod, type FundingIndicatorTimeframe,
  type FundingIndicatorWindow, type FundingIndicatorPoint,
} from '@/hooks/use-funding-indicator';
import { useCvdIndicator, type CvdAnchor, type CvdMarket, type CvdPayload, type CvdTimeframe } from '@/hooks/use-cvd-indicator';
import { PERP_LEVERAGE_FRAMES, usePerpLeverage } from '@/hooks/use-perp-leverage';
import { LSAR_CHART_FRAMES, useLsarChart } from '@/hooks/use-lsar-chart';
import { useAggressiveBubbles, type AggressiveBubblesMarket, type BubbleMinimum } from '@/hooks/use-aggressive-bubbles';
import { useOiDriver, type OiDriverSettings } from '@/hooks/use-oi-driver';
import { OiIndicatorControls } from '@/components/oi-indicator-controls';
import { calculateLiquidityZones, type Candle, type LiquiditySettings } from '@/lib/liquidity-zones';
import type { MarketContract } from '@/hooks/use-market-contracts';
import type { ChartStudyId } from '@/lib/supercharts';
import { DEFAULT_TECHNICAL_SETTINGS, type TechnicalSettings } from '@/lib/technical-indicators';
import { useChartSetting } from '@/hooks/use-chart-setting';
import { chartViewKey } from '@/lib/chart-preferences.js';
import '@/styles/native-super-chart.css';

type OrderflowId = 'liquidity' | 'funding' | 'perpetual-cvd' | 'spot-cvd' | 'aggressive-bubbles' | 'oi-driver' | 'leverage' | 'global-lsar' | 'top-lsar';

type Props = { contract: MarketContract | null; studies: ChartStudyId[]; indicators: OrderflowId[]; onRemoveLayer?: (key: string) => void;
  /** Page parts shown in the single chart toolbar: symbol search and the indicator menus. */
  toolbarStart?: ReactNode; toolbarMenus?: ReactNode;
  /** Chart cell in a multi-chart layout: each cell keeps its own timeframe. */
  cellId?: number };
type ThemeColors = { resistance: string; support: string; inside: string; transparency: number };

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
function contiguousTail(candles: Candle[], timeframe: LiquidityTimeframe) {
  if (candles.length < 2) return candles;
  let start = candles.length - 1;
  while (start > 0 && nextBucket(timeframe, candles[start - 1].time) === candles[start].time) start--;
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
  return <WorkspaceWithContract key={`${props.contract.exchange}:${props.contract.symbol}`}
    contract={props.contract} studies={props.studies} indicators={props.indicators} onRemoveLayer={props.onRemoveLayer}
    toolbarStart={props.toolbarStart} toolbarMenus={props.toolbarMenus} cellId={props.cellId ?? 0} />;
}

const DEFAULT_OI_DRIVER_SETTINGS: OiDriverSettings = { showTotals: true, stateColors: true, showLsar: true, flatBodyPct: 15, activityLength: 20, activityFactor: 3,
      pinbarBodyPct: 10, pinbarWickPct: 50, pinbarWickRatio: 2, spikeMult: 5, avgLength: 50,
      maxSidewaysBars: 10, pullback1: 10, pullback2: 20,
      colors: { up: '#3b82f6', down: '#ef4444', longBuild: '#3b82f6', shortBuild: '#f23645',
        limitBuy: '#22c55e', limitSell: '#f97316', shortExit: '#facc15', longExit: '#a855f7', neutral: '#737373' } };

/** Technical settings owned by each built-in study (reset when that study is removed). */
const STUDY_SETTING_KEYS: Partial<Record<string, Array<keyof TechnicalSettings>>> = {
  ema: ['emaPeriod'], sma: ['smaPeriod'], bb: ['bbPeriod', 'bbStdDev'], rsi: ['rsiPeriod'],
  macd: ['macdFast', 'macdSlow', 'macdSignal'],
};

/** JSON with sorted keys, to compare settings objects. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

function WorkspaceWithContract({ contract, studies, indicators, onRemoveLayer, toolbarStart, toolbarMenus, cellId = 0 }: Props & { contract: MarketContract }) {
  const asset = contract.asset.toUpperCase();
  const [timeframe, setTimeframe] = useChartSetting<LiquidityTimeframe>(cellId ? `timeframe:${cellId}` : 'timeframe', '1h',
    value => (ALL_TIMEFRAMES as string[]).includes(value as string));
  // 1s–30s candles are built from live trades of the selected contract only.
  const secondsMode = isSecondTimeframe(timeframe);
  const [storedVolumeBasis, setVolumeBasis] = useChartSetting<LiquidityVolumeMode>('volumeBasis', 'aggregated',
    value => value === 'single' || value === 'aggregated');
  const volumeBasis: LiquidityVolumeMode = secondsMode ? 'single' : storedVolumeBasis;
  const [showVolume, setShowVolume] = useChartSetting('showVolume', true);
  const [technicalSettings, setTechnicalSettings] = useChartSetting<TechnicalSettings>('technicalSettings', { ...DEFAULT_TECHNICAL_SETTINGS });
  // Parameters for the popular-indicator registry (Ichimoku, Keltner, ...), saved per coin.
  const [extraSettings, setExtraSettings] = useChartSetting<Record<string, Record<string, number>>>('extraIndicatorSettings', {},
    value => !!value && typeof value === 'object' && !Array.isArray(value));
  const [liquiditySettings, setLiquiditySettings] = useChartSetting('liquiditySettings', DEFAULT_LIQUIDITY_SETTINGS);
  const [zoneColors, setZoneColors] = useChartSetting('zoneColors', DEFAULT_ZONE_COLORS);
  const [oiDriverSettings, setOiDriverSettings] = useChartSetting<OiDriverSettings>('oiDriverSettings',
    DEFAULT_OI_DRIVER_SETTINGS,
    value => !!value && typeof value === 'object' && typeof value.showTotals === 'boolean' &&
      typeof value.stateColors === 'boolean' && typeof value.showLsar === 'boolean');
  const hasLiquidity = indicators.includes('liquidity');
  const hasFunding = indicators.includes('funding') && !secondsMode;
  const hasPerpetualCvd = indicators.includes('perpetual-cvd') && !secondsMode;
  const hasSpotCvd = indicators.includes('spot-cvd') && !secondsMode;
  const hasAggressiveBubbles = indicators.includes('aggressive-bubbles') && !secondsMode;
  const hasOiDriver = indicators.includes('oi-driver') && !secondsMode;
  const leverageFrame = PERP_LEVERAGE_FRAMES.includes(timeframe) ? timeframe : null;
  const hasLeverage = indicators.includes('leverage') && !!leverageFrame;
  const lsarFrameOk = LSAR_CHART_FRAMES.includes(timeframe);
  const hasGlobalLsar = indicators.includes('global-lsar') && lsarFrameOk;
  const hasTopLsar = indicators.includes('top-lsar') && lsarFrameOk;
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
  const [fundingWindow, setFundingWindow] = useChartSetting<FundingIndicatorWindow>('fundingWindow', '7d',
    value => ['1d', '7d', '30d'].includes(String(value)));
  const [fundingMethod, setFundingMethod] = useChartSetting<FundingIndicatorMethod>('fundingMethod', 'mean',
    value => ['mean', 'median', 'weighted'].includes(String(value)));
  const [fundingMode, setFundingMode] = useChartSetting<'settled' | 'recordedLive'>('fundingMode', 'settled',
    value => value === 'settled' || value === 'recordedLive');
  const [fundingThreshold, setFundingThreshold] = useChartSetting('fundingThreshold', 0.08);
  const [perpetualAnchor, setPerpetualAnchor] = useChartSetting<CvdAnchor>('perpetualAnchor', '1w',
    value => CVD_ANCHORS.some(anchor => anchor.value === value));
  const [spotAnchor, setSpotAnchor] = useChartSetting<CvdAnchor>('spotAnchor', '1w',
    value => CVD_ANCHORS.some(anchor => anchor.value === value));
  const [bubbleMarket, setBubbleMarket] = useChartSetting<AggressiveBubblesMarket>('bubbleMarket', 'both',
    value => ['spot', 'perpetual', 'both'].includes(String(value)));
  // Default 'auto': about 2-3 bubbles per candle for this coin/timeframe/market (recalculated
  // as data arrives). 'multiplier': k x average candle volume. A typed USD value stays fixed.
  const [bubbleMinValue, setBubbleMinValue] = useChartSetting<BubbleMinimum>('bubbleMinimum', 'auto',
    value => value === 'auto' || value === 'multiplier' || Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100_000_000);
  const [bubbleMultiplier, setBubbleMultiplier] = useChartSetting<number>('bubbleMultiplier', 0.1,
    value => typeof value === 'number' && value >= 0.001 && value <= 100);
  const [bubbleMinDraft, setBubbleMinDraft] = useState<string | null>(null);
  const [bubbleMultDraft, setBubbleMultDraft] = useState<string | null>(null);
  const [bubbleMinError, setBubbleMinError] = useState<string | null>(null);
  // Save / Default per indicator. Changes apply straight away. "Save" keeps the
  // current settings as yours for that indicator (used again when it is
  // re-added); "Default" restores the original settings and forgets the saved
  // ones. Removing an indicator returns it to your saved settings, else defaults.
  const [savedLayers, setSavedLayers] = useChartSetting<Record<string, unknown>>('savedLayerSettings', {},
    (value) => !!value && typeof value === 'object' && !Array.isArray(value));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type LayerKit = { read: () => unknown; apply: (value: any) => void; factory: unknown };
  const kitFor = (key: string): LayerKit | null => {
    const technical = STUDY_SETTING_KEYS[key];
    if (technical) return {
      read: () => Object.fromEntries(technical.map((name) => [name, technicalSettings[name]])),
      apply: (value) => setTechnicalSettings((current) => ({ ...current, ...value })),
      factory: Object.fromEntries(technical.map((name) => [name, DEFAULT_TECHNICAL_SETTINGS[name]])),
    };
    if (extraIndicator(key)?.params.length) return {
      read: () => extraSettings[key] ?? null,
      apply: (value) => setExtraSettings((current) => {
        const next = { ...current };
        if (value) next[key] = value; else delete next[key];
        return next;
      }),
      factory: null,
    };
    switch (key) {
      case 'liquidity': return { read: () => ({ settings: liquiditySettings, colors: zoneColors }),
        apply: (value) => { setLiquiditySettings(value.settings); setZoneColors(value.colors); },
        factory: { settings: DEFAULT_LIQUIDITY_SETTINGS, colors: DEFAULT_ZONE_COLORS } };
      case 'funding': return { read: () => ({ window: fundingWindow, method: fundingMethod, mode: fundingMode, threshold: fundingThreshold }),
        apply: (value) => { setFundingWindow(value.window); setFundingMethod(value.method); setFundingMode(value.mode); setFundingThreshold(value.threshold); },
        factory: { window: '7d', method: 'mean', mode: 'settled', threshold: 0.08 } };
      case 'perpetual-cvd': return { read: () => perpetualAnchor, apply: setPerpetualAnchor, factory: '1w' };
      case 'spot-cvd': return { read: () => spotAnchor, apply: setSpotAnchor, factory: '1w' };
      case 'aggressive-bubbles': return { read: () => ({ market: bubbleMarket, minimum: bubbleMinValue, multiplier: bubbleMultiplier }),
        apply: (value) => { setBubbleMarket(value.market); setBubbleMinValue(value.minimum); setBubbleMultiplier(value.multiplier);
          setBubbleMinDraft(null); setBubbleMultDraft(null); setBubbleMinError(null); },
        factory: { market: 'both', minimum: 'auto', multiplier: 0.1 } };
      case 'oi-driver': return { read: () => oiDriverSettings, apply: setOiDriverSettings, factory: DEFAULT_OI_DRIVER_SETTINGS };
      default: return null;
    }
  };
  const restoreLayer = (key: string) => {
    const kit = kitFor(key);
    if (kit) kit.apply(savedLayers[key] !== undefined ? savedLayers[key] : kit.factory);
  };
  const layerActions = Object.fromEntries([...studies, ...indicators].flatMap((key) => {
    const kit = kitFor(key);
    if (!kit) return [];
    const current = stableJson(kit.read());
    return [[key, {
      saved: savedLayers[key] !== undefined && stableJson(savedLayers[key]) === current,
      atDefault: stableJson(kit.factory) === current,
      onSave: () => setSavedLayers((all) => ({ ...all, [key]: kit.read() })),
      onDefault: () => { kit.apply(kit.factory); setSavedLayers((all) => { const next = { ...all }; delete next[key]; return next; }); },
    }]];
  }));
  const previousLayers = useRef({ studies, indicators });
  useEffect(() => {
    const previous = previousLayers.current;
    previousLayers.current = { studies, indicators };
    const removed = [...previous.studies.filter((id) => !studies.includes(id)), ...previous.indicators.filter((id) => !indicators.includes(id))];
    for (const key of removed) restoreLayer(key);
    // Setters are stable in effect; only layer changes matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studies, indicators]);
  const canonicalAsset = contract.asset.toUpperCase();
  // Minute-based layers are disabled on seconds timeframes; give their hooks a valid frame.
  const flowTimeframe = (secondsMode ? '1m' : timeframe) as CvdTimeframe;
  const perpetualCvd = useCvdIndicator(canonicalAsset, 'perpetual', flowTimeframe, perpetualAnchor, hasPerpetualCvd);
  const spotCvd = useCvdIndicator(canonicalAsset, 'spot', flowTimeframe, spotAnchor, hasSpotCvd);
  const aggressiveBubbles = useAggressiveBubbles(canonicalAsset, flowTimeframe, bubbleMarket, bubbleMinValue, bubbleMultiplier, hasAggressiveBubbles);
  const bubblePayload = aggressiveBubbles.payload && aggressiveBubbles.payload.asset.toUpperCase() === canonicalAsset &&
    aggressiveBubbles.payload.timeframe === timeframe && aggressiveBubbles.payload.market === bubbleMarket &&
    aggressiveBubbles.payload.minValue === bubbleMinValue
    ? aggressiveBubbles.payload : null;
  const oiDriver = useOiDriver(canonicalAsset, timeframe, exchange, nativeSymbol, candles, hasOiDriver, oiDriverSettings);
  const leverage = usePerpLeverage(canonicalAsset, timeframe, exchange, nativeSymbol, hasLeverage);
  const globalLsar = useLsarChart(canonicalAsset, timeframe, 'global', hasGlobalLsar);
  const topLsar = useLsarChart(canonicalAsset, timeframe, 'top', hasTopLsar);
  const lsarPanes = useMemo(() => [
    ...(hasGlobalLsar ? [{ key: 'global-lsar', label: 'Global L/S Account Ratio', color: '#26a69a',
      points: globalLsar.data?.asset === canonicalAsset && globalLsar.data.timeframe === timeframe ? globalLsar.data.points : [] }] : []),
    ...(hasTopLsar ? [{ key: 'top-lsar', label: 'Top Trader L/S Account Ratio', color: '#f59e0b',
      points: topLsar.data?.asset === canonicalAsset && topLsar.data.timeframe === timeframe ? topLsar.data.points : [] }] : []),
  ], [hasGlobalLsar, hasTopLsar, globalLsar.data, topLsar.data, canonicalAsset, timeframe]);
  const leveragePayload = hasLeverage && leverage.data?.asset === canonicalAsset && leverage.data.timeframe === leverageFrame ? leverage.data : null;

  const commitBubbleMinimum = () => {
    if (bubbleMinDraft === null) return;
    if (!/^\d+$/.test(bubbleMinDraft)) {
      setBubbleMinError('Enter a whole USD amount from 1 to 100,000,000.');
      return;
    }
    const next = Number(bubbleMinDraft);
    if (!Number.isSafeInteger(next) || next < 1 || next > 100_000_000) {
      setBubbleMinError('Enter a whole USD amount from 1 to 100,000,000.');
      return;
    }
    setBubbleMinValue(next);
    setBubbleMinDraft(null);
    setBubbleMinError(null);
  };
  const bubbleMinShown = bubbleMinDraft ?? (typeof bubbleMinValue === 'number' ? String(bubbleMinValue)
    : bubblePayload ? String(bubblePayload.effectiveMinValue) : '');
  const bubbleMultShown = bubbleMultDraft ?? (bubbleMinValue === 'multiplier' ? String(bubbleMultiplier)
    : bubblePayload?.volumeMultiplier ? String(Number(bubblePayload.volumeMultiplier.toPrecision(2))) : '');
  const commitBubbleMultiplier = () => {
    if (bubbleMultDraft === null) return;
    const next = Number(bubbleMultDraft);
    if (!(Number.isFinite(next) && next >= 0.001 && next <= 100)) { setBubbleMinError('Enter a multiplier from 0.001 to 100 (× average candle volume).'); return; }
    setBubbleMultiplier(next); setBubbleMinValue('multiplier'); setBubbleMultDraft(null); setBubbleMinDraft(null); setBubbleMinError(null);
  };

  const cvdControls = (market: CvdMarket, enabled: boolean, anchor: CvdAnchor, setAnchor: (value: CvdAnchor) => void,
    feed: ReturnType<typeof useCvdIndicator>) => {
    if (!enabled) return null;
    const payload = feed.payload && feed.payload.asset.toUpperCase() === canonicalAsset &&
      feed.payload.market === market && feed.payload.timeframe === timeframe && feed.payload.anchor === anchor
      ? feed.payload : null;
    const marketLabel = market === 'spot' ? 'Aggregated Spot CVD' : 'Aggregated Perpetual CVD';
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

  const frameButtons = <TimeframePicker value={timeframe} onChange={(value) => setTimeframe(value as LiquidityTimeframe)} />;
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
  // One settings entry per technical study, shown in its chart-legend ⚙ panel.
  const technicalLayerSettings: Record<string, ReactNode> = {
    ema: <PeriodControl label="EMA period" value={technicalSettings.emaPeriod}
      onChange={(value) => setTechnicalSettings((current) => ({ ...current, emaPeriod: value }))} />,
    sma: <PeriodControl label="SMA period" value={technicalSettings.smaPeriod}
      onChange={(value) => setTechnicalSettings((current) => ({ ...current, smaPeriod: value }))} />,
    bb: <>
      <PeriodControl label="Bollinger period" value={technicalSettings.bbPeriod}
        onChange={(value) => setTechnicalSettings((current) => ({ ...current, bbPeriod: value }))} />
      <label className="super-chart-control"><span>Deviation</span><input type="number" min="0.1" max="10" step="0.1"
        value={technicalSettings.bbStdDev} onChange={(event) => { const n = Number(event.target.value); if (Number.isFinite(n) && n > 0 && n <= 10) setTechnicalSettings((current) => ({ ...current, bbStdDev: n })); }} /></label>
    </>,
    rsi: <PeriodControl label="RSI period" value={technicalSettings.rsiPeriod}
      onChange={(value) => setTechnicalSettings((current) => ({ ...current, rsiPeriod: value }))} />,
    macd: <>
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
      <small>Fast period must remain below slow. Periods: 2–500.</small>
    </>,
    ...Object.fromEntries(studies.map((id) => extraIndicator(id)).filter((def) => def && def.params.length).map((def) => [def!.id, (
      <div className="native-extra-params" key={def!.id}>
        {def!.params.map((param) => {
          const value = extraParams(def!.id, extraSettings[def!.id])[param.key];
          return <label className="super-chart-control" key={param.key}><span>{param.label}</span>
            <input type="number" min={param.min} max={param.max} step={param.step} defaultValue={value}
              key={`${def!.id}:${param.key}:${value}`} aria-label={`${def!.label} ${param.label}`}
              onBlur={(event) => {
                const next = Number(event.target.value);
                const ok = Number.isFinite(next) && next >= param.min && next <= param.max && (param.step < 1 || Number.isInteger(next));
                if (!ok) { event.target.value = String(value); return; }
                setExtraSettings((current) => ({ ...current, [def!.id]: { ...extraParams(def!.id, current[def!.id]), [param.key]: next } }));
              }}
              onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
          </label>;
        })}
        <button type="button" className="native-extra-reset" onClick={() => setExtraSettings((current) => {
          const { [def!.id]: _removed, ...rest } = current; return rest; })}>Defaults</button>
      </div>
    )])),
  };

  const chartAndDetails = (funding: FundingPlotData | null, fundingControls: ReactNode) => {
    // Settings for each chart layer, opened from the ⚙ next to its name on the chart.
    const layerSettings: Record<string, ReactNode | undefined> = {
      volume: <label className="super-chart-control"><span>Volume basis</span><select value={volumeBasis}
        onChange={(event) => setVolumeBasis(event.target.value as LiquidityVolumeMode)} aria-label="Volume pane basis">
        <option value="single">Selected venue</option><option value="aggregated">Aggregated · up to 7 venues</option></select></label>,
      liquidity: hasLiquidity ? <>{settingsPanel}{<section className="native-signals">
        <div><span className="module-kicker">QUALIFIED ZONES</span><b>{liquidity.zones.length}</b><small>{liquidity.signals.length} signals in visible feed history</small></div>
        <ul>{[...liquidity.signals].sort((a, b) => b.time - a.time).slice(0, 5).map((signal, index) =>
          <li key={`${signal.time}-${signal.type}-${index}`}><i className={signal.type} /><b>{signal.type === 'breakout' ? 'Breakout' : 'Touch'}</b>
            <span>{signal.zoneIds.length} zone{signal.zoneIds.length === 1 ? '' : 's'}</span><time>{fmtTime(signal.time)}</time>{!signal.closed && <em>Provisional</em>}</li>)}
          {!liquidity.signals.length && <li className="native-no-signals">No zone signals in the available history.</li>}</ul>
      </section>}</> : undefined,
      ...technicalLayerSettings,
      funding: fundingControls ?? undefined,
      'perpetual-cvd': cvdControls('perpetual', hasPerpetualCvd, perpetualAnchor, setPerpetualAnchor, perpetualCvd) || undefined,
      'spot-cvd': cvdControls('spot', hasSpotCvd, spotAnchor, setSpotAnchor, spotCvd) || undefined,
      'aggressive-bubbles': hasAggressiveBubbles ? <section className="native-bubble-controls" aria-label="Aggressive Volume Bubbles controls">
        <div className="native-cvd-heading">
          <div><span className="module-kicker">EXECUTED TRADE ACTIVITY / USD-EQUIVALENT</span><h2>Aggressive Volume Bubbles</h2></div>
          <span className="native-cvd-source-total">{bubblePayload
            ? `${bubblePayload.sources.filter((source) => source.status === 'live').length}/${bubblePayload.sources.length} live sources · up to ${bubblePayload.points.reduce((max, point) => Math.max(max, point.sourceCount), 0)} per level`
            : 'Awaiting recorded executions'}</span>
        </div>
        <div className="native-cvd-control-row native-bubble-control-row">
          <label className="super-chart-control"><span>Market</span><select value={bubbleMarket}
            onChange={(event) => setBubbleMarket(event.target.value as AggressiveBubblesMarket)} aria-label="Aggressive Volume Bubbles market">
            <option value="both">Both markets</option><option value="spot">Spot</option><option value="perpetual">Perpetual</option>
          </select></label>
          <label className="super-chart-control"><span>Minimum USD value</span><input type="number" min="1" max="100000000" step="1"
            value={bubbleMinShown} placeholder={typeof bubbleMinValue === 'number' ? undefined : 'Calculating…'} aria-invalid={!!bubbleMinError} onChange={(event) => { setBubbleMinDraft(event.target.value); setBubbleMinError(null); }}
            onBlur={commitBubbleMinimum} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitBubbleMinimum(); event.currentTarget.blur(); } }}
             aria-label="Minimum aggressive volume bubble USD-equivalent value" /></label>
          <label className="super-chart-control"><span>× avg candle volume</span><input type="number" min="0.001" max="100" step="0.01"
            value={bubbleMultShown} aria-label="Minimum as a multiple of the average candle volume" data-testid="input-bubble-multiplier"
            onChange={(event) => { setBubbleMultDraft(event.target.value); setBubbleMinError(null); }} onBlur={commitBubbleMultiplier}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitBubbleMultiplier(); event.currentTarget.blur(); } }} /></label>
          {bubbleMinValue !== 'auto' && <button type="button" className="native-tool-button" data-testid="button-bubble-auto"
            onClick={() => { setBubbleMinValue('auto'); setBubbleMinDraft(null); setBubbleMultDraft(null); setBubbleMinError(null); }}
            title="Recalculate automatically: about 2–3 bubbles per candle">Auto</button>}

          <span className="native-cvd-count">{bubblePayload ? `${bubblePayload.points.reduce((sum, point) => sum + point.tradeCount, 0).toLocaleString()} trades · ${bubblePayload.sources.length} sources` : 'Price-level executions only'}</span>
          <button type="button" className="native-tool-button" onClick={aggressiveBubbles.refresh} disabled={aggressiveBubbles.loading}>
            <RefreshCw size={12} aria-hidden="true" /> Refresh
          </button>
        </div>
        {bubbleMinError && <p className="native-bubble-error" role="alert">{bubbleMinError}</p>}
        {aggressiveBubbles.loading && !bubblePayload && <p className="native-cvd-status" role="status">Loading recorded execution levels…</p>}
        {aggressiveBubbles.error && <div className="native-cvd-status is-error" role="alert">
          <span>{bubblePayload ? `Refresh issue: ${aggressiveBubbles.error} Cached points remain visible.` : aggressiveBubbles.error}</span>
          <button type="button" onClick={aggressiveBubbles.refresh}>Retry</button>
        </div>}
        {bubblePayload && <>
          <div className="native-cvd-history" role="status">
            <span>{bubblePayload.recordingStartedAt ? `Bubble recording began ${new Date(bubblePayload.recordingStartedAt).toLocaleString()}` : 'Recording start unavailable'}</span>
            <span>{bubblePayload.historyStart ? `First covered executions ${new Date(bubblePayload.historyStart).toLocaleString()}` : 'No covered execution start yet'}</span>
            <span>{bubblePayload.points.length ? `${bubblePayload.points.length} price levels · execution snapshot updates about every 5 seconds` : 'No qualifying newly recorded executions in the live retention window.'}</span>
            <span>{bubblePayload.sources.filter((source) => source.status === 'live').length < bubblePayload.sources.length ? 'Source coverage is partial; unavailable venues are not inferred.' : 'All listed trade sources are live.'}</span>
            <span>History before recording start is unavailable; CVD candle history cannot reconstruct price-level trades.</span>
          </div>
          <div className="native-cvd-sources" aria-label="Aggressive bubble source coverage">
            {bubblePayload.sources.map((source) => <span key={`${source.market}-${source.exchange}`} className={`status-${source.status}`}
              title={[source.symbol, source.lastTradeAt ? `Last trade ${source.lastTradeAt}` : null].filter(Boolean).join(' · ') || source.status}>
              <i aria-hidden="true" />{source.market.toUpperCase()} {source.exchange.toUpperCase()} · {source.status.replace('_', ' ')}
            </span>)}
          </div>
          <details className="native-cvd-method"><summary>Method &amp; coverage notes</summary>
            {bubblePayload.warnings.map((warning, index) => <p className="native-cvd-warning" key={`${index}-${warning}`}>{warning}</p>)}
          </details>
        </>}
        <p className="native-cvd-method">Each bubble is recorded executed buy or sell activity at an aggregated price level—not price direction, an orderbook heatmap, or trader identity. Bubble price is converted from underlying USD-equivalent to this contract’s native price scale.</p>
      </section> : undefined,
      'oi-driver': hasOiDriver ? <OiIndicatorControls settings={oiDriverSettings}
        onChange={next => setOiDriverSettings(next)} payload={oiDriver.payload}
        loading={oiDriver.loading} error={oiDriver.error} /> : undefined,
    };
    return (
    <>
      {/* One toolbar: symbol, price, timeframe, indicator menus, volume, refresh, fit. */}
      <div className="native-chart-toolbar sc-toolbar">
        {toolbarStart}
        <span className="sc-toolbar-quote" title={`${contract.exchange.toUpperCase()} · ${contract.symbol}`}>
          <b>{contract.asset}</b><i>PERP</i><small>{contract.exchange.toUpperCase()}</small>
          <strong>{current?.close.toLocaleString(undefined, { maximumSignificantDigits: 9 }) ?? '—'}</strong>
        </span>
        <span className="sc-sep" aria-hidden="true" />
        {frameButtons}
        <span className="sc-sep" aria-hidden="true" />
        {toolbarMenus}
        <span className="sc-sep" aria-hidden="true" />
        <select className="sc-compact-select" value={volumeBasis} title="Volume basis"
          onChange={(event) => setVolumeBasis(event.target.value as LiquidityVolumeMode)} aria-label="Chart volume basis">
          <option value="single">Volume: selected venue</option><option value="aggregated">Volume: up to 7 venues</option>
        </select>
        <label className="native-volume-toggle sc-compact-toggle" title="Show the volume pane"><input type="checkbox" checked={showVolume}
          onChange={(event) => setShowVolume(event.target.checked)} /> Vol</label>
        <button type="button" className="native-tool-button sc-icon-button" title="Refresh data" aria-label="Refresh data" onClick={() => {
          nativeFeed.refresh();
          if (aggregateRequested) aggregateFeed.refresh();
        }} disabled={nativeFeed.loading || aggregateRequested && aggregateFeed.loading}>
          <RefreshCw size={13} aria-hidden="true" />
        </button>
        <button type="button" className="native-fit-button sc-fit" onClick={() => window.dispatchEvent(new Event('native-chart-fit'))}>Fit</button>
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
      {indicators.some((id) => id === 'global-lsar' || id === 'top-lsar') && !lsarFrameOk && <p className="native-seconds-note" role="status">
        Long Short Account Ratio is available on 5m, 15m, 30m, 1h, 4h and 1D charts (exchanges publish it every 5 minutes).</p>}
      {hasTopLsar && topLsar.isSuccess && !topLsar.data.points.length && <p className="native-seconds-note" role="status">
        No top-trader ratio for {canonicalAsset} yet: Binance, OKX and Gate.io publish it only for some coins, and the server may still be collecting it.</p>}
      {indicators.includes('leverage') && !leverageFrame && <p className="native-seconds-note" role="status">
        Perp Leverage Estimation is available on 5m, 15m, 30m, 1h, 4h and 1D charts.</p>}
      {hasLeverage && leverage.error && !leveragePayload && <p className="native-volume-warning" role="alert">Perp Leverage Estimation: {leverage.error.message}</p>}
      {secondsMode && <p className="native-seconds-note" role="status">
        Seconds candles are built from this contract’s live executed trades since recording started (kept 2 hours) and refresh every 2 seconds; seconds without trades have no candle.
        {indicators.some((id) => ['funding', 'perpetual-cvd', 'spot-cvd', 'aggressive-bubbles', 'oi-driver'].includes(id)) &&
          ' Funding, CVD, bubbles and Open Interest are minute-based data and show from 1m upward.'}
        {nativePayloadCurrent && nativeFeed.payload?.candles.length === 0 && ' Waiting for the first trades…'}
      </p>}
      <div className="native-volume-meta" role="status">
        <span className="native-volume-basis-label">VOLUME · {volumeBasis === 'aggregated' ? 'AGGREGATED MULTI-VENUE' : 'SELECTED NATIVE VENUE'}</span>
        {volumeBasis === 'single' ? <>
          <span>{nativePayloadCurrent ? `${candles.length} native volume bars · ${contract.exchangeAsset}` : nativeFeed.loading ? 'Waiting for native volume' : 'Native volume unavailable'}</span>
          {nativePayloadCurrent && nativeFeed.payload?.stale && <span className="is-warning">Cached volume · freshness unverified</span>}
        </> : !aggregateRequested
          ? <span>Aggregation idle · enable Volume pane or Liquidity Zones to request matched venue volume.</span>
          : <>
            <span>{aggregatePayloadCurrent ? `${aggregateVolumes.length} exact timestamp matches · ${aggregateFeed.payload?.volumeAsset ?? contract.exchangeAsset}` :
              aggregateFeed.loading ? 'Loading matched volume sources' : 'No matching aggregated-volume payload'}</span>
            <span>{aggregatePayloadCurrent ? `${aggregateFeed.payload?.matchedCandleCount ?? aggregateVolumes.length} server-aligned bars · ${aggregateFeed.payload?.volumeSources?.filter((s) => s.status === 'ok').length ?? 0}/${aggregateFeed.payload?.volumeSources?.length ?? 7} sources`
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
        : candles.length ? <NativeSuperChart key={`${contract.exchange}:${contract.symbol}:${timeframe}`}
          viewKey={chartViewKey(asset, contract.exchange, contract.symbol, timeframe)}
          candles={candles} volumeCandles={selectedVolumeCandles} studies={studies} zones={hasLiquidity ? liquidity.zones : []}
          liquiditySettings={liquiditySettings} zoneColors={zoneColors} funding={funding} fundingEnabled={hasFunding} showVolume={showVolume} timeframe={timeframe}
           resetKey={`${contract?.label ?? ''}:${timeframe}`} technicalSettings={technicalSettings} extraSettings={extraSettings}
           layerSettings={layerSettings} layerActions={layerActions} liquidityEnabled={hasLiquidity}
           onRemoveLayer={(key) => key === 'volume' ? setShowVolume(false) : onRemoveLayer?.(key)}
           symbolLabel={`${contract.asset} · ${contract.exchange.toUpperCase()}`}
           perpetualCvd={hasPerpetualCvd ? perpetualCvd.payload : null} spotCvd={hasSpotCvd ? spotCvd.payload : null}
            perpetualCvdEnabled={hasPerpetualCvd} spotCvdEnabled={hasSpotCvd}
             aggressiveBubbles={bubblePayload} aggressiveBubblesEnabled={hasAggressiveBubbles}
             oiDriver={oiDriver.payload} oiDriverEnabled={hasOiDriver} priceDivisor={contract.priceDivisor || 1}
             leverageRows={leveragePayload?.rows ?? null} leverageEnabled={hasLeverage} lsarPanes={lsarPanes} />
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
      {hasLiquidity && volumeBasis === 'aggregated' && aggregateRequested && !aggregatePayloadCurrent && <p className="native-volume-warning" role="status">
        Liquidity Zones are waiting for a matching aggregate-volume feed. Native price/technical candles remain available; zones are not calculated with substitute venue volume.
      </p>}
      {hasLiquidity && volumeBasis === 'aggregated' && aggregatePayloadCurrent && liquidityCandles.length < liquiditySettings.backBars + 30 && <p className="native-volume-warning" role="status">
        Only {liquidityCandles.length} consecutive matched-volume bars are available for Liquidity Zones; {liquiditySettings.backBars + 30} bars are recommended for the scan and warmup. The calculation uses the contiguous matched suffix only.
      </p>}

      <div className="native-method-note">
        <span>i</span><p>Prices and OHLC are from the selected native exchange contract. {volumeBasis === 'aggregated'
          ? 'Volume sums exactly matched underlying-coin volume from up to seven venues (a venue with gaps is left out); it is not open-interest weighted.'
          : 'Volume is from the selected venue only.'}
          {' '}Liquidity zones use the selected volume basis. Missing volume timestamps are left unmatched, never zero-filled or replaced with selected-venue values. Funding values are verified venue observations or settled payments, normalized to an 8-hour rate; red is positive and green is negative. Missing timestamps are left as gaps. Price, volume and funding use roughly 30-second snapshot polling and exchange/server caches. CVD and Aggressive Volume Bubbles reuse recorded public trade streams; bubble points describe newly recorded executions only.</p>
      </div>
    </>
    );
  };

  return <section className="native-workspace" aria-label="Native perpetual chart workspace">
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
  threshold: number; setThreshold: (value: number) => void; render: (plot: FundingPlotData | null, controls: ReactNode) => ReactNode;
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

  // Funding settings live in the chart legend's ⚙ panel (TradingView style).
  const controls = props.enabled ? <section className="native-funding-controls" aria-label="Aggregated funding controls">
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
    </section> : null;
  return <>{props.render(props.enabled ? plot : null, controls)}</>;
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

