import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CandlestickSeries, ColorType, createChart, createSeriesMarkers, HistogramSeries, LineSeries, MismatchDirection,
  type IChartApi, type ISeriesApi, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, LiquidityZone, LiquiditySettings } from '@/lib/liquidity-zones';
import { LiquidityZonePrimitive } from '@/components/liquidity-zone-primitive';
import { calculateTechnicalIndicators, type TechnicalSettings } from '@/lib/technical-indicators';
import type { ChartStudyId } from '@/lib/supercharts';
import { computeExtraIndicator, extraIndicator, type ExtraResult } from '@/lib/extra-indicators';
import { BandFillPrimitive } from '@/components/band-fill-primitive';
import { TIMEFRAME_LABELS } from '../../server/timeframes.js';
import { ChartPaneLegends, type LayerActions, type LegendPane, type LegendRow } from '@/components/chart-pane-legends';
import { extraParams } from '@/lib/extra-indicators';
import type { FundingIndicatorMethod, FundingIndicatorPoint } from '@/hooks/use-funding-indicator';
import type { CvdPayload } from '@/hooks/use-cvd-indicator';
import type { AggressiveBubble } from '@/hooks/use-aggressive-bubbles';
import type { AggregatedOiPayload } from '@/hooks/use-aggregated-oi';
import { AggressiveBubblesPrimitive, type PlottedAggressiveBubble } from '@/components/aggressive-bubbles-primitive';
import { VolumeProfilePrimitive } from '@/components/volume-profile-primitive';
import type { SessionProfile, VolumeProfileSettings } from '@/lib/volume-profile';
import type { MarketDriverBar, MarketDriverLabel, MarketDriverSettings } from '@/lib/market-driver';
import { chartTimeFormatters, offsetLabel, useTimeZone } from '@/lib/time-zone';
import { readChartPreference, writeChartPreference, validChartView, shiftedChartRange } from '@/lib/chart-preferences.js';

type FundingPlot = { points: FundingIndicatorPoint[]; method: FundingIndicatorMethod; threshold: number };
type Props = {
  candles: Candle[];
  volumeCandles: Candle[];
  studies: ChartStudyId[];
  zones: LiquidityZone[];
  liquiditySettings: LiquiditySettings;
  zoneColors: { resistance: string; support: string; inside: string; transparency: number };
  funding: FundingPlot | null;
  /** Show the funding pane even before its data arrives. */
  fundingEnabled?: boolean;
  showVolume: boolean;
  timeframe: string;
  resetKey: string;
  viewKey: string;
  technicalSettings: TechnicalSettings;
  perpetualCvd: CvdPayload | null;
  spotCvd: CvdPayload | null;
  perpetualCvdEnabled: boolean;
  spotCvdEnabled: boolean;
  aggressiveBubbles: { points: AggressiveBubble[] } | null;
  aggressiveBubblesEnabled: boolean;
  oiDriver: Pick<AggregatedOiPayload, 'candles'> | null;
  oiDriverEnabled: boolean;
  /** Driver mode: state colours + spike/pullback alert labels (off = classic aggregated OI). */
  /** Multi-chart sync: this chart's id and which things follow the other charts. */
  syncId?: number;
  sync?: { crosshair: boolean; time: boolean; range: boolean };
  /** Leverage Estimate rows (time in ms); score 0–100. */
  /** Perp Leverage Estimation rows (time in seconds; values are leverage in ×). */
  leverageRows?: Array<{ time: number; avg: number | null; long: number | null; short: number | null }> | null;
  leverageEnabled?: boolean;
  /** Message shown in the middle of a pane that has no data for this timeframe (pane stays). */
  paneNotes?: Record<string, string>;
  /** Long Short Account Ratio panes (global / top trader); time in seconds. */
  lsarPanes?: Array<{ key: string; label: string; color: string; points: Array<{ time: number; ratio: number; longPct: number }> }>;
  priceDivisor: number;
  /** Saved parameters for the popular-indicator registry, by indicator id. */
  extraSettings?: Record<string, Record<string, number>>;
  /** Settings UI per layer key, shown in the legend's ⚙ panel. */
  layerSettings?: Record<string, ReactNode | undefined>;
  /** Session Volume Profile (real aggressive buy/sell volume at price). */
  volumeProfiles?: SessionProfile[] | null;
  volumeProfileSettings?: VolumeProfileSettings | null;
  /** Indicators kept on the chart but not drawn (eye button). */
  hiddenLayers?: string[];
  onToggleLayer?: (key: string) => void;
  /** Plot style for line indicators that can also be columns (funding, L/S ratios). */
  layerStyles?: Record<string, 'line' | 'columns'>;
  /** Market Driver (owner's script) computed per candle. */
  marketDriver?: { bars: Array<MarketDriverBar | null>; labels: MarketDriverLabel[]; settings: MarketDriverSettings;
    totals: { oiCoin: number | null; oiUsd: number | null; dailyVolumeUsd: number | null; average20dVolumeUsd: number | null } } | null;
  marketDriverEnabled?: boolean;
  /** Aggregated liquidations per candle (USD) and the feed exchanges' OI (USD). */
  liquidations?: Array<{ time: number; longUsd: number | null; shortUsd: number | null; oiUsd: number | null }> | null;
  liquidationsEnabled?: boolean;
  liquidationLabels?: boolean;
  /** Save / Default buttons per layer key. */
  layerActions?: Record<string, LayerActions>;
  onRemoveLayer?: (key: string) => void;
  liquidityEnabled?: boolean;
  symbolLabel?: string;
};
/** Strong TradingView-style green / red, clear on the light and dark chart backgrounds. */
export const CHART_COLORS = {
  up: '#089981', down: '#f23645',
  volumeUp: 'rgba(8,153,129,0.5)', volumeDown: 'rgba(242,54,69,0.5)',
  histUp: 'rgba(8,153,129,0.9)', histDown: 'rgba(242,54,69,0.9)',
  ema: '#f6c06a', sma: '#6fd6c8', bbBand: '#b8a4ee', bbMid: '#9d86e8',
  rsi: '#7cc8f5', macd: '#f6c06a', signal: '#7cc8f5',
} as const;
type Theme = { page: string; surface: string; muted: string; border: string; accent: string; positive: string };
type Bundle = { chart: IChartApi; candleSeries: ISeriesApi<'Candlestick'>; volumeSeries: ISeriesApi<'Histogram'> | null; primitive: LiquidityZonePrimitive | null; bubblePrimitive: AggressiveBubblesPrimitive | null; fills: BandFillPrimitive[]; profilePrimitive?: VolumeProfilePrimitive | null };
type SavedView = {
  from: number; to: number; anchorTime: number; anchorLogical: number;
  panes: Record<string, { weight: number; autoScale: boolean; range: { from: number; to: number } | null }>;
};

function themeColors(element: HTMLElement): Theme {
  const styles = getComputedStyle(element);
  return {
    page: styles.getPropertyValue('--lsar-page').trim() || '#101411',
    surface: styles.getPropertyValue('--lsar-surface').trim() || '#171c18',
    muted: styles.getPropertyValue('--lsar-muted').trim() || '#929b92',
    border: styles.getPropertyValue('--lsar-border').trim() || '#303831',
    accent: styles.getPropertyValue('--lsar-accent').trim() || '#a6c69a',
    positive: styles.getPropertyValue('--lsar-positive').trim() || CHART_COLORS.up,
  };
}

function priceFormat(candles: Candle[]) {
  const value = candles.at(-1)?.close ?? 1;
  const precision = Math.min(12, value < 1 ? Math.max(2, Math.ceil(-Math.log10(value)) + 2) : 2);
  return { type: 'price' as const, precision, minMove: 10 ** -precision };
}

const toTime = (time: number) => time as UTCTimestamp;
const LEVERAGE_COLORS = { avg: '#f59e0b', long: '#22c55e', short: '#ef4444' };
const NO_LSAR_PANES: NonNullable<Props['lsarPanes']> = [];
const NO_NOTES: Record<string, string> = {};

function compactCvd(value: number) {
  const magnitude = Math.abs(value);
  const unit = magnitude >= 1_000_000_000 ? 'B' : magnitude >= 1_000_000 ? 'M' : magnitude >= 1_000 ? 'K' : '';
  const divisor = unit === 'B' ? 1_000_000_000 : unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1;
  return `${value < 0 ? '−' : ''}${(magnitude / divisor).toLocaleString(undefined, { maximumFractionDigits: unit ? 2 : 1 })}${unit}`;
}

const NO_HIDDEN: string[] = [];
const NO_STYLES: Record<string, 'line' | 'columns'> = {};
export function NativeSuperChart({ candles, volumeCandles, studies, zones, liquiditySettings, zoneColors, funding, showVolume, timeframe, resetKey, viewKey, technicalSettings, perpetualCvd, spotCvd, perpetualCvdEnabled, spotCvdEnabled, aggressiveBubbles, aggressiveBubblesEnabled, oiDriver, oiDriverEnabled, syncId = 0, sync, fundingEnabled = false, leverageRows = null, leverageEnabled = false, lsarPanes = NO_LSAR_PANES, paneNotes = NO_NOTES, priceDivisor, extraSettings = {}, layerSettings = {}, layerActions = {}, onRemoveLayer, liquidityEnabled = false, symbolLabel, volumeProfiles = null, volumeProfileSettings = null, hiddenLayers = NO_HIDDEN, onToggleLayer, layerStyles = NO_STYLES, marketDriver = null, marketDriverEnabled = false, liquidations = null, liquidationsEnabled = false, liquidationLabels = true }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const bundleRef = useRef<Bundle | null>(null);
  const seriesRef = useRef<Array<ISeriesApi<any>>>([]);
  const paneCountRef = useRef(0);
  const paneKeysRef = useRef<string[]>([]);
  const candleDataRef = useRef(candles);
  const resetKeyRef = useRef(resetKey);
  const hasChartDataRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const restoringRef = useRef(true);
  const savedViewRef = useRef<SavedView | null>(readChartPreference(viewKey, null, validChartView));
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const syncIdRef = useRef(syncId);
  syncIdRef.current = syncId;
  const captureViewRef = useRef<() => void>(() => {});
  const [hover, setHover] = useState<Candle | null>(null);
  // Candle under the pointer only while the pointer is inside the Market Driver pane.
  const [driverHoverTime, setDriverHoverTime] = useState<number | null>(null);
  // Top offset of every pane, for the TradingView-style legends.
  const [paneLayout, setPaneLayout] = useState<Array<{ key: string; top: number; height: number }>>([]);
  // Chart times are shown in the chosen time zone (header menu); candles stay exchange (UTC) candles.
  const [timeZone] = useTimeZone();
  const timeZoneRef = useRef(timeZone);
  timeZoneRef.current = timeZone;
  useEffect(() => {
    const formatters = chartTimeFormatters(timeZone);
    bundleRef.current?.chart.applyOptions({
      localization: { locale: 'en-US', timeFormatter: (time: Time) => formatters.timeFormatter(Number(time)) },
      timeScale: { tickMarkFormatter: (time: Time, type: number) => formatters.tickMarkFormatter(Number(time), type) },
    });
  }, [timeZone]);
  const measurePanes = useCallback(() => {
    const chart = bundleRef.current?.chart;
    if (!chart) return;
    // Measure where each pane really is on screen: right after a redraw the library can
    // report 0 height for recreated panes while they are already drawn.
    const origin = mountRef.current?.getBoundingClientRect().top ?? 0;
    let top = 0;
    const next = chart.panes().map((pane, index) => {
      const rect = pane.getHTMLElement?.()?.getBoundingClientRect();
      const height = rect && rect.height > 0 ? rect.height : pane.getHeight();
      const at = rect && rect.height > 0 ? Math.round(rect.top - origin) : top;
      const item = { key: paneKeysRef.current[index] ?? `pane-${index}`, top: at, height: Math.round(height) };
      top = at + height + 1; // 1px pane separator
      return item;
    });
    setPaneLayout((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  const measureRef = useRef(measurePanes);
  measureRef.current = measurePanes;
  const [bubbleHover, setBubbleHover] = useState<PlottedAggressiveBubble | null>(null);
  // A bubble is drawn only where it traded: inside its own candle's high-low range
  // (0.1% tolerance for small price differences between exchanges).
  const plottedBubbles = useMemo(() => {
    const byTime = new Map(candles.map((bar) => [bar.time, bar]));
    const divisor = Number.isFinite(priceDivisor) && priceDivisor > 0 ? priceDivisor : 1;
    return (aggressiveBubbles?.points ?? [])
      .filter((point) => Number.isFinite(point.price) && point.price > 0 && Number.isFinite(point.value) && point.value >= 0)
      .map((point) => ({ ...point, nativePrice: point.price * divisor }))
      .filter((point) => {
        const bar = byTime.get(point.time);
        return !!bar && point.nativePrice >= bar.low * 0.999 && point.nativePrice <= bar.high * 1.001;
      });
  }, [aggressiveBubbles, priceDivisor, candles]);
  // Aggregated OI in USD (coins x this chart's price), chained so each candle opens at the previous close.
  const oiUsdBars = useMemo(() => {
    const prices = new Map(candles.map((bar) => [bar.time, bar.close]));
    let lastPrice: number | null = null, previousClose: number | null = null;
    return (oiDriver?.candles ?? []).flatMap((bar) => {
      const price = prices.get(bar.time) ?? lastPrice;
      if (!price) return [];
      lastPrice = price;
      const close = bar.close * price;
      const open = previousClose ?? bar.open * price;
      previousClose = close;
      return [{ ...bar, open, close, high: Math.max(open, close, bar.high * price), low: Math.min(open, close, bar.low * price) }];
    });
  }, [oiDriver, candles]);
  const marketDriverBox = useMemo(() => {
    if (!marketDriverEnabled || !marketDriver) return null;
    const bars = marketDriver.bars.filter((bar): bar is MarketDriverBar => !!bar);
    const time = driverHoverTime ?? candles.at(-1)?.time ?? null;
    const bar = bars.find((item) => item.time === time) ?? bars.at(-1);
    if (!bar) return null;
    return { bar, totals: marketDriver.settings.showTotals ? marketDriver.totals : null };
  }, [marketDriverEnabled, marketDriver, driverHoverTime, candles]);
  candleDataRef.current = candles;
  const volumeByTime = useMemo(() => new Map(volumeCandles.map((bar) => [bar.time, bar.volume])), [volumeCandles]);
  const studyData = useMemo(() => calculateTechnicalIndicators(candles, technicalSettings), [candles, technicalSettings]);
  // Popular indicators (Ichimoku, Keltner, Stochastic, ...) from the registry.
  const extraData = useMemo(() => studies.flatMap((id) => {
    const result = extraIndicator(id) ? computeExtraIndicator(id, candles, extraSettings[id]) : null;
    return result ? [[id, result] as [ChartStudyId, ExtraResult]] : [];
  }), [studies, candles, extraSettings]);
  const fundingRows = useMemo(() => {
    if (!funding || !candles.length) return [];
    const start = candles[0].time;
    const end = candles[candles.length - 1].time;
    const field = funding.method === 'mean' ? 'meanPct' : funding.method === 'median' ? 'medianPct' : 'weightedPct';
    return funding.points
      .filter((point) => point.time >= start && point.time <= end)
      .sort((a, b) => a.time - b.time)
      .map((point) => ({ time: toTime(point.time), value: point[field] ?? null }))
      // A funding rate stays in force until the next one: carry it across gaps so the line reaches the live rate.
      .map((row, index, rows) => {
        if (row.value !== null || index === 0) return row;
        for (let k = index - 1; k >= 0; k--) if (rows[k].value !== null) return { ...row, value: rows[k].value };
        return row;
      });
  }, [funding, candles]);
  const insufficientStudies = useMemo(() => {
    const count = candles.length;
    const messages: string[] = [];
    if (studies.includes('ema') && studyData.ema.length === 0) messages.push(`EMA needs ${technicalSettings.emaPeriod} closes (available ${count})`);
    if (studies.includes('sma') && studyData.sma.length === 0) messages.push(`SMA needs ${technicalSettings.smaPeriod} closes (available ${count})`);
    if (studies.includes('bb') && studyData.bb.middle.length === 0) messages.push(`Bollinger Bands need ${technicalSettings.bbPeriod} closes (available ${count})`);
    if (studies.includes('rsi') && studyData.rsi.length === 0) messages.push(`RSI needs ${technicalSettings.rsiPeriod + 1} closes (available ${count})`);
    const macdRequired = technicalSettings.macdSlow + technicalSettings.macdSignal - 1;
    if (studies.includes('macd') && studyData.macd.histogram.length === 0) messages.push(`MACD needs ${macdRequired} closes (available ${count})`);
    for (const [id, result] of extraData) {
      if (!result.series.some((series) => series.data.some((point) => point.value !== null)))
        messages.push(`${extraIndicator(id)?.label ?? id} needs more history (available ${count})`);
    }
    return messages;
  }, [candles.length, studies, studyData, technicalSettings, extraData]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const palette = themeColors(mount);
    const chart = createChart(mount, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: palette.surface }, textColor: palette.muted, fontFamily: 'var(--app-font-mono), monospace', attributionLogo: true,
        panes: { separatorColor: palette.border, separatorHoverColor: palette.accent } },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: palette.border, timeVisible: true, secondsVisible: false, rightOffset: 5 },
      crosshair: { vertLine: { color: palette.accent }, horzLine: { color: palette.accent } },
      localization: { locale: 'en-US', timeFormatter: (time: Time) => chartTimeFormatters(timeZoneRef.current).timeFormatter(Number(time)) },
    });
    chart.applyOptions({ timeScale: { tickMarkFormatter: (time: Time, type: number) => chartTimeFormatters(timeZoneRef.current).tickMarkFormatter(Number(time), type) } });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      priceFormat: priceFormat(candles),
      upColor: CHART_COLORS.up, downColor: CHART_COLORS.down, borderVisible: false,
      wickUpColor: CHART_COLORS.up, wickDownColor: CHART_COLORS.down, priceLineVisible: false,
    }, 0);
    bundleRef.current = { chart, candleSeries, volumeSeries: null, primitive: null, bubblePrimitive: null, fills: [] };
    const captureView = () => {
      if (restoringRef.current || !hasChartDataRef.current) return;
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      const anchor = candleSeries.dataByIndex(Math.floor((range.from + range.to) / 2), MismatchDirection.NearestLeft)
        ?? candleSeries.dataByIndex(0, MismatchDirection.NearestRight);
      if (!anchor || typeof anchor.time !== 'number') return;
      const coordinate = chart.timeScale().timeToCoordinate(anchor.time);
      const logical = coordinate === null ? null : chart.timeScale().coordinateToLogical(coordinate);
      if (logical === null) return;
      const panes: SavedView['panes'] = { ...savedViewRef.current?.panes };
      chart.panes().forEach((pane, index) => {
        const key = paneKeysRef.current[index];
        if (!key) return;
        const scale = chart.priceScale('right', index);
        const options = scale.options();
        const visible = scale.getVisibleRange();
        panes[key] = { weight: pane.getStretchFactor(), autoScale: options.autoScale || !visible, range: visible };
      });
      const view = { ...range, anchorTime: anchor.time, anchorLogical: logical, panes };
      if (!validChartView(view)) return;
      savedViewRef.current = view;
      writeChartPreference(viewKey, view);
    };
    captureViewRef.current = captureView;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSave = () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveTimer = null; captureView(); }, 150);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleSave);
    // Price-axis dragging and pane resizing have no range subscription.
    // Capture after their gestures too, and synchronously before unmount.
    window.addEventListener('pointerup', scheduleSave);
    mount.addEventListener('wheel', scheduleSave, { passive: true });
    window.addEventListener('pagehide', captureView);
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const next = themeColors(mount);
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: next.surface }, textColor: next.muted,
          panes: { separatorColor: next.border, separatorHoverColor: next.accent } },
        rightPriceScale: { borderColor: next.border }, timeScale: { borderColor: next.border },
        crosshair: { vertLine: { color: next.accent }, horzLine: { color: next.accent } },
      });
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    const resize = new ResizeObserver(() => {
      chart.applyOptions({ width: mount.clientWidth });
      requestAnimationFrame(() => measureRef.current());
    });
    const remeasure = () => requestAnimationFrame(() => measureRef.current());
    window.addEventListener('pointerup', remeasure);
    resize.observe(mount);
    const crosshairHandler = (param: Parameters<IChartApi['subscribeCrosshairMove']>[0] extends (arg: infer A) => void ? A : never) => {
      if (!param.time) { setHover(null); setBubbleHover(null); setDriverHoverTime(null); return; }
      const time = typeof param.time === 'number' ? param.time : null;
      const inDriverPane = param.paneIndex !== undefined && paneKeysRef.current[param.paneIndex] === 'market-driver';
      setDriverHoverTime(inDriverPane ? time : null);
      setHover(time === null ? null : candleDataRef.current.find((item) => item.time === time) ?? null);
      const point = (param.paneIndex === undefined || param.paneIndex === 0) && param.seriesData.has(candleSeries) ? param.point : undefined;
      setBubbleHover(point ? bundleRef.current?.bubblePrimitive?.findBubbleAt(point.x, point.y) ?? null : null);
    };
    chart.subscribeCrosshairMove(crosshairHandler);
    // ---- Multi-chart sync (crosshair, time, date range) between charts in the layout ----
    let applying = false;
    const release = () => requestAnimationFrame(() => { applying = false; });
    const broadcast = (detail: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('sc-sync', { detail: { source: syncIdRef.current, ...detail } }));
    const syncCrosshair = (param: Parameters<IChartApi['subscribeCrosshairMove']>[0] extends (arg: infer A) => void ? A : never) => {
      if (applying || !syncRef.current?.crosshair) return;
      broadcast({ type: 'crosshair', time: typeof param.time === 'number' ? param.time : null });
    };
    chart.subscribeCrosshairMove(syncCrosshair);
    const syncRange = () => {
      if (applying || !(syncRef.current?.range || syncRef.current?.time)) return;
      const range = chart.timeScale().getVisibleRange();
      if (range) broadcast({ type: 'range', from: range.from, to: range.to });
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(syncRange);
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      if (detail.source === syncIdRef.current || !syncRef.current) return;
      const bars = candleDataRef.current;
      if (detail.type === 'crosshair' && syncRef.current.crosshair) {
        applying = true;
        setDriverHoverTime(null);
        if (detail.time === null || !bars.length) { chart.clearCrosshairPosition(); setHover(null); }
        else {
          // Same moment on this chart: the candle that contains it (timeframes can differ).
          let bar = bars[0];
          for (const item of bars) { if (item.time <= detail.time) bar = item; else break; }
          chart.setCrosshairPosition(bar.close, bar.time as UTCTimestamp, candleSeries);
          setHover(bar);
        }
        release();
      } else if (detail.type === 'range' && (syncRef.current.range || syncRef.current.time)) {
        applying = true;
        try {
          if (syncRef.current.range) chart.timeScale().setVisibleRange({ from: detail.from, to: detail.to });
          else {
            // Time: keep this chart's zoom, scroll so it ends at the same moment.
            const own = chart.timeScale().getVisibleRange();
            const width = own ? Number(own.to) - Number(own.from) : Number(detail.to) - Number(detail.from);
            chart.timeScale().setVisibleRange({ from: (Number(detail.to) - width) as UTCTimestamp, to: detail.to });
          }
        } catch { /* range outside this chart's data */ }
        release();
      }
    };
    window.addEventListener('sc-sync', onSync);
    const fitHandler = () => chart.timeScale().fitContent();
    window.addEventListener('native-chart-fit', fitHandler);
    return () => {
      captureView();
      if (saveTimer !== null) clearTimeout(saveTimer);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleSave);
      window.removeEventListener('pointerup', scheduleSave);
      window.removeEventListener('pointerup', remeasure);
      mount.removeEventListener('wheel', scheduleSave);
      window.removeEventListener('pagehide', captureView);
      observer.disconnect();
      resize.disconnect();
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.unsubscribeCrosshairMove(syncCrosshair);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(syncRange);
      window.removeEventListener('sc-sync', onSync);
      window.removeEventListener('native-chart-fit', fitHandler);
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      const activeBundle = bundleRef.current;
      if (activeBundle?.primitive) activeBundle.candleSeries.detachPrimitive(activeBundle.primitive);
      if (activeBundle?.bubblePrimitive) activeBundle.candleSeries.detachPrimitive(activeBundle.bubblePrimitive);
      seriesRef.current = [];
      hasChartDataRef.current = false;
      paneCountRef.current = 0;
      paneKeysRef.current = [];
      chart.remove();
      bundleRef.current = null;
    };
  }, [viewKey]);

  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      hasChartDataRef.current = false;
      setHover(null);
    }
  }, [resetKey]);

  useEffect(() => {
    const bundle = bundleRef.current;
    if (!bundle) return;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    const { chart, candleSeries } = bundle;
    captureViewRef.current();
    restoringRef.current = true;
    const savedView = savedViewRef.current;
    const range = chart.timeScale().getVisibleLogicalRange();
    const previousWeights = new Map(paneKeysRef.current.map((key, index) =>
      [key, chart.panes()[index]?.getStretchFactor()] as const));
    if (bundle.primitive) candleSeries.detachPrimitive(bundle.primitive);
    if (bundle.bubblePrimitive) candleSeries.detachPrimitive(bundle.bubblePrimitive);
    if (bundle.profilePrimitive) { candleSeries.detachPrimitive(bundle.profilePrimitive); bundle.profilePrimitive = null; }
    for (const fill of bundle.fills) candleSeries.detachPrimitive(fill);
    bundle.fills = [];
    if (!aggressiveBubblesEnabled) setBubbleHover(null);
    // Recreate only the chart's series; the chart instance and shared viewport remain stable.
    for (const series of seriesRef.current) chart.removeSeries(series);
    seriesRef.current = [];
    candleSeries.applyOptions({ priceFormat: priceFormat(candles), visible: candles.length > 0 });
    candleSeries.setData(candles.map((bar) => ({ time: toTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close })));
    // Every series is tagged with its indicator so hidden ones can be switched off.
    let layer = '';
    const layerSeries = new Map<string, ISeriesApi<any>[]>();
    const isHidden = (key: string) => hiddenLayers.includes(key);
    const pushSeries = (series: ISeriesApi<any>) => {
      seriesRef.current.push(series);
      if (layer) layerSeries.set(layer, [...(layerSeries.get(layer) ?? []), series]);
      return series;
    };
    const volumePane = showVolume ? 1 : null;
    layer = 'volume';
    if (showVolume) {
      const volumeSeries = pushSeries(chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' }, priceScaleId: '', lastValueVisible: false, priceLineVisible: false,
      }, 1));
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0 } });
      volumeSeries.setData(volumeCandles.map((bar) => ({
        time: toTime(bar.time), value: bar.volume, color: bar.close >= bar.open ? CHART_COLORS.volumeUp : CHART_COLORS.volumeDown,
      })));
      bundle.volumeSeries = volumeSeries;
    } else bundle.volumeSeries = null;

    const priceOverlay = (id: ChartStudyId, data: Array<{ time: number; value: number | null }>, color: string, width: number) => {
      if (!studies.includes(id) || !data.length) return;
      layer = id;
      const line = pushSeries(chart.addSeries(LineSeries, { color, lineWidth: width as 1 | 2 | 3 | 4, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0));
      line.setData(data.filter((point): point is { time: number; value: number } => point.value !== null && Number.isFinite(point.value))
        .map((point) => ({ time: toTime(point.time), value: point.value })));
    };
    priceOverlay('ema', studyData.ema, CHART_COLORS.ema, 2);
    priceOverlay('sma', studyData.sma, CHART_COLORS.sma, 2);
    layer = 'bb';
    if (studies.includes('bb') && studyData.bb.middle.length) {
      for (const [data, color] of [[studyData.bb.upper, CHART_COLORS.bbBand], [studyData.bb.middle, CHART_COLORS.bbMid], [studyData.bb.lower, CHART_COLORS.bbBand]] as const) {
        const line = pushSeries(chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0));
        line.setData(data.filter((point) => point.value !== null && Number.isFinite(point.value)).map((point) => ({ time: toTime(point.time), value: point.value! })));
      }
    }

    // ---- Popular indicators: shared renderer for overlays and panes ----
    const drawExtra = (result: ExtraResult, pane: number) => {
      let first: ISeriesApi<any> | null = null;
      for (const item of result.series) {
        const data = item.data.map((point) => point.value === null || !Number.isFinite(point.value)
          ? { time: toTime(point.time) } : { time: toTime(point.time), value: point.value });
        const common = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: item.type !== 'dots',
          ...(result.range ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: result.range![0], maxValue: result.range![1] } }) } : {}) };
        const series = item.type === 'histogram'
          ? pushSeries(chart.addSeries(HistogramSeries, { ...common }, pane))
          : pushSeries(chart.addSeries(LineSeries, { ...common, color: item.color, lineWidth: (item.width ?? 1) as 1 | 2 | 3 | 4,
            lineStyle: item.dashed ? 2 : 0, ...(item.step ? { lineType: 1 } : {}),
            ...(item.hidden ? { lineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null } : {}), ...(item.type === 'dots' ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 } : {}) }, pane));
        series.setData(item.type === 'histogram'
          ? data.map((point, index) => 'value' in point ? { ...point, color: item.data[index].color
            ?? ((point.value as number) >= 0 ? CHART_COLORS.histUp : CHART_COLORS.histDown) } : point)
          : data);
        first ??= series;
      }
      for (const level of result.levels ?? []) {
        first?.createPriceLine({ price: level.value, color: '#89928a88', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: level.label ?? String(level.value) });
      }
      if (pane === 0 && !isHidden(layer)) {
        for (const fill of result.fills ?? []) {
          const upper = result.series.find((item) => item.key === fill.upper);
          const lower = new Map(result.series.find((item) => item.key === fill.lower)?.data.map((point) => [point.time, point.value]) ?? []);
          if (!upper) continue;
          const primitive = new BandFillPrimitive({ series: candleSeries, timeScale: chart.timeScale(), up: fill.up, down: fill.down,
            points: upper.data.map((point) => ({ time: point.time, upper: point.value, lower: lower.get(point.time) ?? null })) });
          candleSeries.attachPrimitive(primitive);
          bundle.fills.push(primitive);
        }
      }
    };
    for (const [id, result] of extraData) if (extraIndicator(id)?.placement === 'overlay') { layer = id; drawExtra(result, 0); }

    paneCountRef.current = 0;
    const nextPane = () => (volumePane === null ? 1 : 2) + paneCountRef.current++;
    layer = 'rsi';
    if (studies.includes('rsi') && studyData.rsi.length) {
      const pane = nextPane();
      const rsi = pushSeries(chart.addSeries(LineSeries, {
        color: CHART_COLORS.rsi, lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      }, pane));
      rsi.setData(studyData.rsi.filter((point) => point.value !== null).map((point) => ({ time: toTime(point.time), value: point.value! })));
      rsi.createPriceLine({ price: 70, color: CHART_COLORS.volumeDown, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '70' });
      rsi.createPriceLine({ price: 30, color: CHART_COLORS.volumeUp, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '30' });
    }
    layer = 'macd';
    if (studies.includes('macd') && studyData.macd.histogram.length) {
      const pane = nextPane();
      const macdPriceFormat = priceFormat(candles);
      const hist = pushSeries(chart.addSeries(HistogramSeries, { priceFormat: macdPriceFormat, priceLineVisible: false, lastValueVisible: false }, pane));
      hist.setData(studyData.macd.histogram.filter((point) => point.value !== null).map((point) => ({
        time: toTime(point.time), value: point.value!, color: point.value! >= 0 ? CHART_COLORS.histUp : CHART_COLORS.histDown,
      })));
      hist.createPriceLine({ price: 0, color: '#89928a88', lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
      const line = pushSeries(chart.addSeries(LineSeries, { color: CHART_COLORS.macd, lineWidth: 1, priceFormat: macdPriceFormat, priceLineVisible: false, lastValueVisible: false }, pane));
      line.setData(studyData.macd.macd.filter((point) => point.value !== null).map((point) => ({ time: toTime(point.time), value: point.value! })));
      const signal = pushSeries(chart.addSeries(LineSeries, { color: CHART_COLORS.signal, lineWidth: 1, priceFormat: macdPriceFormat, priceLineVisible: false, lastValueVisible: false }, pane));
      signal.setData(studyData.macd.signal.filter((point) => point.value !== null).map((point) => ({ time: toTime(point.time), value: point.value! })));
    }
    for (const [id, result] of extraData) if (extraIndicator(id)?.placement === 'pane') { layer = id; drawExtra(result, nextPane()); }
    layer = 'funding';
    if (funding || fundingEnabled) {
      const pane = nextPane();
      const threshold = funding?.threshold ?? 0.08;
      const fundingOptions = {
        priceFormat: { type: 'price' as const, precision: 4, minMove: 0.0001 }, priceLineVisible: true, priceLineStyle: 2, lastValueVisible: true,
        autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
          const info = original();
          return info ? { ...info, priceRange: {
            minValue: Math.min(info.priceRange.minValue, -threshold),
            maxValue: Math.max(info.priceRange.maxValue, threshold),
          } } : null;
        },
      };
      // Line by default; columns (positive red / negative green) as a setting.
      const asColumns = layerStyles.funding === 'columns';
      const fund = asColumns
        ? pushSeries(chart.addSeries(HistogramSeries, fundingOptions, pane))
        : pushSeries(chart.addSeries(LineSeries, { ...fundingOptions, color: CHART_COLORS.histDown, lineWidth: 2 }, pane));
      fund.setData(fundingRows.map((point) => point.value === null
        ? { time: point.time }
        : asColumns ? { ...point, color: point.value >= 0 ? CHART_COLORS.histDown : CHART_COLORS.histUp }
          : { time: point.time, value: point.value, color: point.value >= 0 ? CHART_COLORS.histDown : CHART_COLORS.histUp }));
      fund.createPriceLine({ price: threshold, color: '#c76b6180', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '+' });
      fund.createPriceLine({ price: -threshold, color: '#4e9c6880', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '−' });
      fund.createPriceLine({ price: 0, color: '#89928a70', lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
    }
    const addCvdPane = (payload: CvdPayload | null, enabled: boolean, key: string) => {
      if (!enabled) return;
      layer = key;
      const pane = nextPane();
      const series = pushSeries(chart.addSeries(CandlestickSeries, {
        priceFormat: { type: 'custom', formatter: compactCvd, minMove: 0.01 },
        upColor: CHART_COLORS.up, downColor: CHART_COLORS.down, borderVisible: false,
        wickUpColor: CHART_COLORS.up, wickDownColor: CHART_COLORS.down, priceLineVisible: false,
      }, pane));
      series.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.08 } });
      // Missing timestamps stay missing; cumulative values are never carried across gaps.
      series.setData((payload?.candles ?? []).map((bar) => ({
        time: toTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        color: bar.close >= bar.open ? CHART_COLORS.up : CHART_COLORS.down,
        wickColor: bar.close >= bar.open ? CHART_COLORS.up : CHART_COLORS.down,
        borderColor: bar.close >= bar.open ? CHART_COLORS.up : CHART_COLORS.down,
      })));
    };
    addCvdPane(perpetualCvd, perpetualCvdEnabled, 'perpetual-cvd');
    addCvdPane(spotCvd, spotCvdEnabled, 'spot-cvd');
    layer = 'oi-driver';
    if (oiDriverEnabled) {
      const pane = nextPane();
      const oiSeries = pushSeries(chart.addSeries(CandlestickSeries, {
        priceFormat: { type: 'custom', formatter: compactCvd, minMove: 0.01 },
        upColor: '#3b82f6', downColor: '#ef4444', borderVisible: false,
        wickUpColor: '#3b82f6', wickDownColor: '#ef4444', priceLineVisible: false,
      }, pane));
      oiSeries.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.08 } });
      oiSeries.setData(oiUsdBars.map(bar => ({
        time: toTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        color: bar.close >= bar.open ? '#26a69a' : '#ef5350', wickColor: bar.close >= bar.open ? '#26a69a' : '#ef5350', borderColor: bar.close >= bar.open ? '#26a69a' : '#ef5350',
      })));
    }
    // The pane stays on the chart even before data arrives (empty, with its label).
    layer = 'market-driver';
    if (marketDriverEnabled) {
      const pane = nextPane();
      const series = pushSeries(chart.addSeries(CandlestickSeries, {
        priceFormat: { type: 'custom', formatter: compactCvd, minMove: 0.01 }, borderVisible: true, priceLineVisible: false,
      }, pane));
      series.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0.08 } });
      const bars = (marketDriver?.bars ?? []).filter((bar): bar is MarketDriverBar => !!bar);
      series.setData(bars.map((bar) => ({ time: toTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        color: bar.bodyColor, wickColor: bar.color, borderColor: bar.color })));
      // Whale OI spike labels and bullish / bearish signal states.
      const markers = [
        // Whale OI spike: a short vertical tick pointing at the candle with the rise % on top, always green.
        ...(marketDriver?.labels ?? []).flatMap((item) => [
          { time: item.time, position: 'aboveBar' as const, color: '#22c55e', shape: 'circle' as const, size: 0, text: '│' },
          { time: item.time, position: 'aboveBar' as const, color: '#22c55e', shape: 'circle' as const, size: 0, text: item.text },
        ]),
        ...bars.filter((bar) => bar.bullId).map((bar) => ({ time: bar.time, position: 'belowBar' as const, color: '#22c55e', shape: 'arrowUp' as const, text: '' })),
        ...bars.filter((bar) => bar.bearId).map((bar) => ({ time: bar.time, position: 'aboveBar' as const, color: '#ef4444', shape: 'arrowDown' as const, text: '' })),
      ].sort((a, b) => a.time - b.time).map((marker) => ({ ...marker, time: toTime(marker.time) }));
      if (markers.length) createSeriesMarkers(series, markers);
    }
    layer = 'liquidations';
    if (liquidationsEnabled) {
      const pane = nextPane();
      const common = { priceFormat: { type: 'custom' as const, formatter: (value: number) => compactCvd(Math.abs(value)), minMove: 0.01 }, priceLineVisible: false };
      const longs = pushSeries(chart.addSeries(HistogramSeries, { ...common, color: '#26a69a', lastValueVisible: true, title: 'Long' }, pane));
      const shorts = pushSeries(chart.addSeries(HistogramSeries, { ...common, color: '#ef4444', lastValueVisible: true, title: 'Short' }, pane));
      const rows = liquidations ?? [];
      longs.setData(rows.map((row) => row.longUsd === null ? { time: toTime(row.time) } : { time: toTime(row.time), value: row.longUsd }));
      shorts.setData(rows.map((row) => row.shortUsd === null ? { time: toTime(row.time) } : { time: toTime(row.time), value: -row.shortUsd }));
      longs.createPriceLine({ price: 0, color: '#89928a55', lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
      // % of open interest liquidated, on the last closed candle only.
      const closed = rows.length > 1 ? rows[rows.length - 2] : null;
      if (liquidationLabels && closed && closed.oiUsd) {
        const longPct = (closed.longUsd ?? 0) / closed.oiUsd * 100, shortPct = (closed.shortUsd ?? 0) / closed.oiUsd * 100;
        if (longPct > 0.0001) createSeriesMarkers(longs, [{ time: toTime(closed.time), position: 'aboveBar', color: '#26a69a', shape: 'circle', size: 0, text: `${longPct.toFixed(2)}%` }]);
        if (shortPct > 0.0001) createSeriesMarkers(shorts, [{ time: toTime(closed.time), position: 'belowBar', color: '#ef4444', shape: 'circle', size: 0, text: `${shortPct.toFixed(2)}%` }]);
      }
    }
    layer = 'leverage';
    if (leverageEnabled) {
      const pane = nextPane();
      const lineFor = (field: 'avg' | 'long' | 'short', color: string, width: 1 | 2 | 3) => {
        const line = pushSeries(chart.addSeries(LineSeries, {
          color, lineWidth: width, priceLineVisible: false, lastValueVisible: field === 'avg',
          priceFormat: { type: 'custom', formatter: (value: number) => value.toFixed(0), minMove: 1 },
        }, pane));
        line.setData((leverageRows ?? []).map((row) => row[field] === null || !Number.isFinite(row[field]!)
          ? { time: toTime(row.time) } : { time: toTime(row.time), value: row[field]! }));
        return line;
      };
      lineFor('long', LEVERAGE_COLORS.long, 1);
      lineFor('short', LEVERAGE_COLORS.short, 1);
      const avg = lineFor('avg', LEVERAGE_COLORS.avg, 3);
      // Reference lines at 10× and 25× (typical retail leverage zones).
      avg.createPriceLine({ price: 10, color: '#89928a90', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '10×' });
      avg.createPriceLine({ price: 25, color: '#89928a60', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '25×' });
    }
    for (const lsar of lsarPanes) {
      layer = lsar.key;
      const pane = nextPane();
      const lsarOptions = { color: lsar.color, priceLineVisible: false, priceFormat: { type: 'price' as const, precision: 2, minMove: 0.01 } };
      // Line by default; columns measured from 1.0 (more longs above, more shorts below) as a setting.
      const asColumns = layerStyles[lsar.key] === 'columns';
      const line = asColumns
        ? pushSeries(chart.addSeries(HistogramSeries, { ...lsarOptions, base: 1 }, pane))
        : pushSeries(chart.addSeries(LineSeries, { ...lsarOptions, lineWidth: 2 }, pane));
      line.setData(lsar.points.map((point) => ({ time: toTime(point.time), value: point.ratio,
        ...(asColumns ? { color: point.ratio >= 1 ? '#26a69a' : '#ef5350' } : {}) })));
      // 1.0 = as many long as short accounts.
      line.createPriceLine({ price: 1, color: '#89928a90', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    }
    // Set proportions together after every pane exists. Sequential pixel-height
    // changes during add/remove can progressively squeeze sibling panes.
    const lowerPanes = [
      ...(showVolume ? [{ key: 'volume', height: 88 }] : []),
      ...(studies.includes('rsi') && studyData.rsi.length ? [{ key: 'rsi', height: 110 }] : []),
      ...(studies.includes('macd') && studyData.macd.histogram.length ? [{ key: 'macd', height: 130 }] : []),
      ...extraData.filter(([id]) => extraIndicator(id)?.placement === 'pane')
        .map(([id]) => ({ key: `extra-${id}`, height: extraIndicator(id)?.paneHeight ?? 110 })),
      ...(funding || fundingEnabled ? [{ key: 'funding', height: 112 }] : []),
      ...(perpetualCvdEnabled ? [{ key: 'perpetual-cvd', height: 142 }] : []),
      ...(spotCvdEnabled ? [{ key: 'spot-cvd', height: 142 }] : []),
      ...(oiDriverEnabled ? [{ key: 'oi-driver', height: 158 }] : []),
      ...(marketDriverEnabled ? [{ key: 'market-driver', height: 180 }] : []),
      ...(liquidationsEnabled ? [{ key: 'liquidations', height: 130 }] : []),
      ...(leverageEnabled ? [{ key: 'leverage', height: 140 }] : []),
      ...lsarPanes.map((lsar) => ({ key: lsar.key, height: 110 })),
    ];
    const priceHeight = Math.max(260, (mountRef.current?.clientHeight ?? 650) -
      lowerPanes.reduce((sum, pane) => sum + pane.height, 0) - 30);
    const allocations = [{ key: 'price', height: priceHeight }, ...lowerPanes];
    chart.panes().forEach((pane, index) => {
      const allocation = allocations[index];
      if (!allocation) return;
      const previous = savedView?.panes[allocation.key]?.weight ?? previousWeights.get(allocation.key);
      pane.setStretchFactor(previous && Number.isFinite(previous) ? previous : allocation.height);
    });
    paneKeysRef.current = allocations.map(pane => pane.key);
    layer = '';
    if (zones.length && !isHidden('liquidity')) {
      const primitive = new LiquidityZonePrimitive({ series: candleSeries, timeScale: chart.timeScale(), zones, candles, style: zoneColors });
      candleSeries.attachPrimitive(primitive);
      bundle.primitive = primitive;
    } else bundle.primitive = null;
    if (aggressiveBubblesEnabled && !isHidden('aggressive-bubbles')) {
      const primitive = new AggressiveBubblesPrimitive({
        series: candleSeries, timeScale: chart.timeScale(), points: plottedBubbles, enabled: true,
      });
      candleSeries.attachPrimitive(primitive);
      bundle.bubblePrimitive = primitive;
    } else bundle.bubblePrimitive = null;
    if (volumeProfiles && volumeProfileSettings && !isHidden('volume-profile')) {
      const primitive = new VolumeProfilePrimitive({ series: candleSeries, timeScale: chart.timeScale(),
        times: candles.map((bar) => bar.time), profiles: volumeProfiles, settings: volumeProfileSettings });
      candleSeries.attachPrimitive(primitive);
      bundle.profilePrimitive = primitive;
    }
    for (const key of hiddenLayers) for (const series of layerSeries.get(key) ?? []) series.applyOptions({ visible: false });
    chart.applyOptions({ timeScale: { timeVisible: true, secondsVisible: false } });
    if (candles.length) {
      const shouldFit = resetKeyRef.current !== resetKey || !hasChartDataRef.current;
      resetKeyRef.current = resetKey;
      hasChartDataRef.current = true;
      if (shouldFit) animationFrameRef.current = requestAnimationFrame(() => {
        if (!restoreView()) chart.timeScale().fitContent();
        restoringRef.current = false;
        captureViewRef.current();
        animationFrameRef.current = null;
      });
      else if (range) animationFrameRef.current = requestAnimationFrame(() => {
        if (!restoreView()) chart.timeScale().setVisibleLogicalRange(range);
        restoringRef.current = false;
        captureViewRef.current();
        animationFrameRef.current = null;
      });
    } else hasChartDataRef.current = false;
    function restoreView() {
      if (!savedView) return false;
      chart.panes().forEach((_, index) => {
        const pane = savedView.panes[paneKeysRef.current[index]];
        if (!pane) return;
        const scale = chart.priceScale('right', index);
        scale.applyOptions({ autoScale: pane.autoScale });
        if (!pane.autoScale && pane.range) scale.setVisibleRange(pane.range);
      });
      // Find the same timestamp in the new snapshot rather than assuming
      // candle indexes are stable when live bars or indicator history arrive.
      const coordinate = chart.timeScale().timeToCoordinate(toTime(savedView.anchorTime));
      const anchor = coordinate === null ? null : chart.timeScale().coordinateToLogical(coordinate);
      if (anchor !== null) {
        chart.timeScale().setVisibleLogicalRange(shiftedChartRange(savedView, anchor));
      } else {
        // If the saved anchor has aged outside the provider's history, retain
        // the zoom width at the closest available timestamp.
        const closest = candles.reduce((best, bar) =>
          Math.abs(bar.time - savedView.anchorTime) < Math.abs(best.time - savedView.anchorTime) ? bar : best, candles[0]);
        const x = chart.timeScale().timeToCoordinate(toTime(closest.time));
        const index = x === null ? null : chart.timeScale().coordinateToLogical(x);
        if (index === null) return false;
        chart.timeScale().setVisibleLogicalRange(shiftedChartRange(savedView, index));
      }
      return true;
    }
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
    // Pane heights settle over a few frames after a redraw: measure again so labels sit on their panes.
    requestAnimationFrame(() => measureRef.current());
    for (const delay of [60, 200, 600]) window.setTimeout(() => measureRef.current(), delay);
  }, [candles, volumeCandles, studies, studyData, extraData, zones, zoneColors, funding, fundingRows, showVolume, liquiditySettings, timeframe, resetKey, perpetualCvd, spotCvd, perpetualCvdEnabled, spotCvdEnabled, aggressiveBubblesEnabled, plottedBubbles, oiDriver, oiUsdBars, oiDriverEnabled, fundingEnabled, leverageRows, leverageEnabled, lsarPanes, volumeProfiles, volumeProfileSettings, hiddenLayers, layerStyles, marketDriver, marketDriverEnabled, liquidations, liquidationsEnabled, liquidationLabels]);

  // ---- TradingView-style legends: name, inputs and value at the crosshair ----
  const legendTime = hover?.time ?? candles.at(-1)?.time ?? null;
  const legendPanes = useMemo<LegendPane[]>(() => {
    const at = (data: Array<{ time: number; value: number | null }> | undefined) => {
      if (!data || legendTime === null) return null;
      for (let i = data.length - 1; i >= 0; i--) if (data[i].time <= legendTime) return data[i].time === legendTime ? data[i].value : null;
      return null;
    };
    const num = (value: number | null | undefined) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—';
      const abs = Math.abs(value);
      // Full prices like TradingView; only very large values (volume, CVD, OBV) are abbreviated.
      if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
      if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
      return value.toLocaleString(undefined, { maximumSignificantDigits: 7 });
    };
    const bar = candles.find((item) => item.time === legendTime) ?? null;
    const tone = bar ? (bar.close >= bar.open ? CHART_COLORS.up : CHART_COLORS.down) : undefined;
    const priceRows: LegendRow[] = [{ key: 'price', label: symbolLabel ?? 'Price', params: TIMEFRAME_LABELS[timeframe] ?? timeframe,
      values: bar ? [`O ${num(bar.open)}`, `H ${num(bar.high)}`, `L ${num(bar.low)}`, `C ${num(bar.close)}`].map((text) => ({ text, color: tone })) : [] }];
    if (studies.includes('ema') && studyData.ema.length) priceRows.push({ key: 'ema', label: 'EMA', params: String(technicalSettings.emaPeriod), color: CHART_COLORS.ema, values: [{ text: num(at(studyData.ema)), color: CHART_COLORS.ema }] });
    if (studies.includes('sma') && studyData.sma.length) priceRows.push({ key: 'sma', label: 'SMA', params: String(technicalSettings.smaPeriod), color: CHART_COLORS.sma, values: [{ text: num(at(studyData.sma)), color: CHART_COLORS.sma }] });
    if (studies.includes('bb') && studyData.bb.middle.length) priceRows.push({ key: 'bb', label: 'BB', params: `${technicalSettings.bbPeriod} ${technicalSettings.bbStdDev}`, color: CHART_COLORS.bbBand,
      values: [studyData.bb.upper, studyData.bb.middle, studyData.bb.lower].map((data) => ({ text: num(at(data)), color: CHART_COLORS.bbBand })) });
    const extraRow = (id: ChartStudyId, result: ExtraResult): LegendRow => {
      const def = extraIndicator(id)!;
      return { key: id, label: def.label, params: Object.values(extraParams(id, extraSettings[id])).join(' '), color: result.series[0]?.color,
        values: result.summary ? [{ text: result.summary }]
          : result.series.filter((series) => !series.hidden).map((series) => ({ text: num(at(series.data)), color: series.color })) };
    };
    for (const [id, result] of extraData) if (extraIndicator(id)?.placement === 'overlay') priceRows.push(extraRow(id, result));
    if (liquidityEnabled) priceRows.push({ key: 'liquidity', label: 'Liquidity Zones', params: `${zones.length} zones`, color: '#9ccfb8' });
    if (volumeProfiles && volumeProfileSettings) {
      const latest = volumeProfiles.at(-1);
      priceRows.push({ key: 'volume-profile', label: 'Session Volume Profile', color: '#24bac7',
        params: `${volumeProfiles.length} session${volumeProfiles.length === 1 ? '' : 's'} · UTC`,
        values: latest ? [{ text: `POC ${num(latest.poc)}`, color: '#e5e7eb' }, { text: `VAH ${num(latest.vah)}`, color: '#5091ff' }, { text: `VAL ${num(latest.val)}`, color: '#5091ff' }]
          : paneNotes['volume-profile'] ? [{ text: paneNotes['volume-profile'] }] : [{ text: 'Collecting trades…' }] });
    }
    if (aggressiveBubblesEnabled) priceRows.push({ key: 'aggressive-bubbles', label: 'Aggressive Volume Bubbles', color: CHART_COLORS.up,
      ...(paneNotes['aggressive-bubbles'] ? { values: [{ text: paneNotes['aggressive-bubbles'] }] } : { params: `${plottedBubbles.length} levels` }) });
    const extrasByPane = new Map(extraData.map(([id, result]) => [`extra-${id}`, extraRow(id, result)]));
    const cvdValue = (payload: CvdPayload | null) => num(payload?.candles.find((item) => item.time === legendTime)?.close ?? null);
    const rowsFor = (key: string): LegendRow[] => {
      if (key === 'price') return priceRows;
      if (key === 'volume') return [{ key: 'volume', label: 'Volume', values: [{ text: num(legendTime === null ? null : volumeByTime.get(legendTime) ?? null) }] }];
      if (key === 'rsi') return [{ key: 'rsi', label: 'RSI', params: String(technicalSettings.rsiPeriod), color: CHART_COLORS.rsi, values: [{ text: num(at(studyData.rsi)), color: CHART_COLORS.rsi }] }];
      if (key === 'macd') return [{ key: 'macd', label: 'MACD', params: `${technicalSettings.macdFast} ${technicalSettings.macdSlow} ${technicalSettings.macdSignal}`, color: CHART_COLORS.macd,
        values: [{ text: num(at(studyData.macd.macd)), color: CHART_COLORS.macd }, { text: num(at(studyData.macd.signal)), color: CHART_COLORS.signal }, { text: num(at(studyData.macd.histogram)) }] }];
      if (extrasByPane.has(key)) return [extrasByPane.get(key)!];
      if (key === 'funding') return [{ key: 'funding', label: 'Aggregated Funding', params: `${funding?.method ?? ''} · 8h`, color: CHART_COLORS.down,
        values: [{ text: (() => { const v = fundingRows.find((row) => row.time === legendTime)?.value; return v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(4)}%`; })() }] }];
      if (key === 'perpetual-cvd') return [{ key: 'perpetual-cvd', label: 'Aggregated Perpetual CVD', params: (perpetualCvd?.anchor ?? '1w').toUpperCase(), color: CHART_COLORS.up, values: [{ text: cvdValue(perpetualCvd) }] }];
      if (key === 'spot-cvd') return [{ key: 'spot-cvd', label: 'Aggregated Spot CVD', params: (spotCvd?.anchor ?? '1w').toUpperCase(), color: CHART_COLORS.up, values: [{ text: cvdValue(spotCvd) }] }];
      if (key === 'liquidations') {
        const rows = liquidations ?? [];
        const row = rows.find((item) => item.time === legendTime) ?? rows.at(-1);
        const pct = (value: number | null) => row?.oiUsd && value !== null ? ` (${(value / row.oiUsd * 100).toFixed(2)}%)` : '';
        const net = row && row.longUsd !== null && row.shortUsd !== null ? row.shortUsd - row.longUsd : null;
        const values = row && row.longUsd !== null ? [
          { text: `Long $${compactCvd(row.longUsd ?? 0)}${pct(row.longUsd)}`, color: '#26a69a' },
          { text: `Short $${compactCvd(row.shortUsd ?? 0)}${pct(row.shortUsd)}`, color: '#ef4444' },
          ...(net !== null && row.oiUsd ? [{ text: `Net ${net >= 0 ? '+' : ''}${(net / row.oiUsd * 100).toFixed(2)}% of OI`, color: net >= 0 ? '#26a69a' : '#ef4444' }] : []),
        ] : paneNotes.liquidations ? undefined : [{ text: rows.length ? 'Feed not connected for this candle' : 'Collecting liquidations...' }];
        return [{ key: 'liquidations', label: 'Aggregated Liquidations', params: 'USD · % of OI', color: '#26a69a', values }];
      }
      if (key === 'market-driver') {
        const hasBars = (marketDriver?.bars ?? []).some((bar) => !!bar);
        return [{ key: 'market-driver', label: 'Market Driver', params: 'Agg OI in coins · Top L/S', color: '#3b82f6',
          values: hasBars ? [] : paneNotes['market-driver'] ? undefined : [{ text: 'Collecting data...' }] }];
      }
      if (key === 'oi-driver') {
        const bar = oiUsdBars.find((item) => item.time === legendTime) ?? oiUsdBars.at(-1);
        const tone = bar ? (bar.close >= bar.open ? '#3b82f6' : '#ef4444') : undefined;
        return [{ key: 'oi-driver', label: 'Aggregated Open Interest', params: `· Agg · USD`, color: '#3b82f6',
          values: bar ? [bar.open, bar.high, bar.low, bar.close].map((value, index) => ({ text: `${'OHLC'[index]} ${compactCvd(value)}`, color: tone }))
            : paneNotes['oi-driver'] ? undefined : [{ text: 'Collecting data…' }] }];
      }
      const lsar = lsarPanes.find((item) => item.key === key);
      if (lsar) {
        const point = lsar.points.find((item) => item.time === legendTime) ?? lsar.points.at(-1);
        return [{ key, label: lsar.label, params: 'OI-weighted', color: lsar.color,
          values: point ? [{ text: point.ratio.toFixed(2), color: lsar.color }, { text: `${point.longPct.toFixed(1)}% long` }] : paneNotes[key] ? [] : [{ text: 'No data for this coin yet' }] }];
      }
      if (key === 'leverage') {
        const rows = (leverageRows ?? []).filter((item) => item.avg !== null);
        const row = rows.find((item) => item.time === legendTime) ?? rows.at(-1);
        const x = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value.toFixed(1)}×`;
        return [{ key: 'leverage', label: 'Perp Leverage Estimation', params: 'avg leverage ×', color: LEVERAGE_COLORS.avg,
          values: row ? [{ text: `Avg ${x(row.avg)}`, color: LEVERAGE_COLORS.avg }, { text: `Long ${x(row.long)}`, color: LEVERAGE_COLORS.long },
            { text: `Short ${x(row.short)}`, color: LEVERAGE_COLORS.short }] : paneNotes.leverage ? [] : [{ text: 'Collecting data…' }] }];
      }
      return [];
    };
    return paneLayout.map((pane) => ({ ...pane, rows: rowsFor(pane.key) })).filter((pane) => pane.rows.length);
  }, [paneLayout, legendTime, candles, studies, studyData, technicalSettings, extraData, extraSettings, liquidityEnabled, zones.length,
    aggressiveBubblesEnabled, plottedBubbles.length, volumeByTime, funding?.method, fundingRows, perpetualCvd, spotCvd, oiDriver?.asset, oiUsdBars, leverageRows, lsarPanes, paneNotes, symbolLabel, timeframe, volumeProfiles, volumeProfileSettings, marketDriver, liquidations]);

  return (
    <div className="native-chart-wrap">
      <div className="native-chart-readout" aria-live="polite">
        <span>{TIMEFRAME_LABELS[timeframe] ?? timeframe} · {offsetLabel(timeZone)}</span>
        {hover ? <><b>O {hover.open.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</b><b>H {hover.high.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</b>
          <b>L {hover.low.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</b><b>C {hover.close.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</b>
          <span>V {volumeByTime.has(hover.time) ? volumeByTime.get(hover.time)!.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</span></> : <span>OHLC · move pointer over a candle</span>}
        {bubbleHover && <span className={`native-bubble-readout ${bubbleHover.side}`}>
          {bubbleHover.market.toUpperCase()} {bubbleHover.side.toUpperCase()} · ${bubbleHover.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} · {bubbleHover.nativePrice.toLocaleString(undefined, { maximumSignificantDigits: 8 })}
          · {bubbleHover.tradeCount.toLocaleString()} trades · {bubbleHover.sourceCount} sources
        </span>}
      </div>
      {insufficientStudies.length > 0 && <div className="native-study-warmup" role="status">
        <strong>Insufficient history for selected studies</strong><span>{insufficientStudies.join(' · ')}</span>
      </div>}
      <div className="native-chart-stage">
        <div className="native-chart-canvas" ref={mountRef} role="img" aria-label="Native exchange-fed candlestick chart with synchronized indicator panes" />
        {/* Clear frames between panes (the chart's own separator stays draggable underneath). */}
        {paneLayout.slice(1).map((pane) => <div key={pane.key} className="pane-divider" style={{ top: pane.top }} aria-hidden="true" />)}
        {marketDriverBox && paneLayout.filter((pane) => pane.key === 'market-driver').map((pane) => {
          const { bar, totals } = marketDriverBox;
          return (
            <div key="md-box" className="md-box" style={{ top: pane.top + pane.height - 6 }} data-testid="market-driver-box">
              <div className="md-box-state" style={{ color: bar.stateColor }}>{bar.driverTop}</div>
              {bar.driverBottom && <div className="md-box-note" style={{ color: bar.stateColor }}>{bar.driverBottom}</div>}
              {(bar.pullback1 || bar.pullback2) && <div className="md-box-row is-pullback">Pullback {bar.pullback2 ? '20%' : '10%'}</div>}
              {totals && <dl className="md-box-totals">
                <dt>Total OI</dt><dd>{totals.oiCoin ? compactCvd(totals.oiCoin) : '-'}</dd>
                <dt>OI value</dt><dd>{totals.oiUsd ? `$${compactCvd(totals.oiUsd)}` : '-'}</dd>
                <dt>Daily vol</dt><dd>{totals.dailyVolumeUsd ? `$${compactCvd(totals.dailyVolumeUsd)}` : '-'}</dd>
                <dt>20D avg vol</dt><dd>{totals.average20dVolumeUsd ? `$${compactCvd(totals.average20dVolumeUsd)}` : '-'}</dd>
              </dl>}
            </div>
          );
        })}
        {paneLayout.filter((pane) => paneNotes[pane.key]).map((pane) => (
          <div key={`note-${pane.key}`} className="pane-note" style={{ top: pane.top, height: pane.height }} role="status">
            <span>{paneNotes[pane.key]}</span></div>
        ))}
        <ChartPaneLegends panes={legendPanes} settings={layerSettings} actions={layerActions} onRemove={onRemoveLayer}
          hidden={hiddenLayers} onToggleHidden={onToggleLayer} />
      </div>
    </div>
  );
}

