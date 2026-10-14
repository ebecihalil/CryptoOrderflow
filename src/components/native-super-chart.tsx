import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries, ColorType, createChart, HistogramSeries, LineSeries,
  type IChartApi, type ISeriesApi, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, LiquidityZone, LiquiditySettings } from '@/lib/liquidity-zones';
import { LiquidityZonePrimitive } from '@/components/liquidity-zone-primitive';
import { calculateTechnicalIndicators, type TechnicalSettings } from '@/lib/technical-indicators';
import type { ChartStudyId } from '@/lib/supercharts';
import type { FundingIndicatorMethod, FundingIndicatorPoint } from '@/hooks/use-funding-indicator';
import type { CvdPayload } from '@/hooks/use-cvd-indicator';

type FundingPlot = { points: FundingIndicatorPoint[]; method: FundingIndicatorMethod; threshold: number };
type Props = {
  candles: Candle[];
  volumeCandles: Candle[];
  studies: ChartStudyId[];
  zones: LiquidityZone[];
  liquiditySettings: LiquiditySettings;
  zoneColors: { resistance: string; support: string; inside: string; transparency: number };
  funding: FundingPlot | null;
  showVolume: boolean;
  timeframe: string;
  resetKey: string;
  technicalSettings: TechnicalSettings;
  perpetualCvd: CvdPayload | null;
  spotCvd: CvdPayload | null;
  perpetualCvdEnabled: boolean;
  spotCvdEnabled: boolean;
};
type Theme = { page: string; surface: string; muted: string; border: string; accent: string; positive: string };
type Bundle = { chart: IChartApi; candleSeries: ISeriesApi<'Candlestick'>; volumeSeries: ISeriesApi<'Histogram'> | null; primitive: LiquidityZonePrimitive | null };

function themeColors(element: HTMLElement): Theme {
  const styles = getComputedStyle(element);
  return {
    page: styles.getPropertyValue('--lsar-page').trim() || '#101411',
    surface: styles.getPropertyValue('--lsar-surface').trim() || '#171c18',
    muted: styles.getPropertyValue('--lsar-muted').trim() || '#929b92',
    border: styles.getPropertyValue('--lsar-border').trim() || '#303831',
    accent: styles.getPropertyValue('--lsar-accent').trim() || '#a6c69a',
    positive: styles.getPropertyValue('--lsar-positive').trim() || '#4e9c68',
  };
}

function priceFormat(candles: Candle[]) {
  const value = candles.at(-1)?.close ?? 1;
  const precision = Math.min(12, value < 1 ? Math.max(2, Math.ceil(-Math.log10(value)) + 2) : 2);
  return { type: 'price' as const, precision, minMove: 10 ** -precision };
}

const toTime = (time: number) => time as UTCTimestamp;

function compactCvd(value: number) {
  const magnitude = Math.abs(value);
  const unit = magnitude >= 1_000_000_000 ? 'B' : magnitude >= 1_000_000 ? 'M' : magnitude >= 1_000 ? 'K' : '';
  const divisor = unit === 'B' ? 1_000_000_000 : unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1;
  return `${value < 0 ? '−' : ''}${(magnitude / divisor).toLocaleString(undefined, { maximumFractionDigits: unit ? 2 : 1 })}${unit}`;
}

export function NativeSuperChart({ candles, volumeCandles, studies, zones, liquiditySettings, zoneColors, funding, showVolume, timeframe, resetKey, technicalSettings, perpetualCvd, spotCvd, perpetualCvdEnabled, spotCvdEnabled }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const bundleRef = useRef<Bundle | null>(null);
  const seriesRef = useRef<Array<ISeriesApi<any>>>([]);
  const paneCountRef = useRef(0);
  const paneKeysRef = useRef<string[]>([]);
  const candleDataRef = useRef(candles);
  const resetKeyRef = useRef(resetKey);
  const hasChartDataRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  candleDataRef.current = candles;
  const volumeByTime = useMemo(() => new Map(volumeCandles.map((bar) => [bar.time, bar.volume])), [volumeCandles]);
  const studyData = useMemo(() => calculateTechnicalIndicators(candles, technicalSettings), [candles, technicalSettings]);
  const fundingRows = useMemo(() => {
    if (!funding || !candles.length) return [];
    const start = candles[0].time;
    const end = candles[candles.length - 1].time;
    const field = funding.method === 'mean' ? 'meanPct' : funding.method === 'median' ? 'medianPct' : 'weightedPct';
    return funding.points
      .filter((point) => point.time >= start && point.time <= end)
      .sort((a, b) => a.time - b.time)
      .map((point) => ({ time: toTime(point.time), value: point[field] ?? null }));
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
    return messages;
  }, [candles.length, studies, studyData, technicalSettings]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const palette = themeColors(mount);
    const chart = createChart(mount, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: palette.surface }, textColor: palette.muted, fontFamily: 'var(--app-font-mono), monospace', attributionLogo: true,
        panes: { separatorColor: palette.border, separatorHoverColor: palette.accent } },
      grid: { vertLines: { color: palette.border }, horzLines: { color: palette.border } },
      rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: palette.border, timeVisible: true, secondsVisible: false, rightOffset: 5 },
      crosshair: { vertLine: { color: palette.accent }, horzLine: { color: palette.accent } },
      localization: { locale: 'en-US' },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      priceFormat: priceFormat(candles),
      upColor: palette.positive, downColor: '#c76b61', borderVisible: false,
      wickUpColor: palette.positive, wickDownColor: '#c76b61', priceLineVisible: false,
    }, 0);
    bundleRef.current = { chart, candleSeries, volumeSeries: null, primitive: null };
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const next = themeColors(mount);
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: next.surface }, textColor: next.muted,
          panes: { separatorColor: next.border, separatorHoverColor: next.accent } },
        grid: { vertLines: { color: next.border }, horzLines: { color: next.border } },
        rightPriceScale: { borderColor: next.border }, timeScale: { borderColor: next.border },
        crosshair: { vertLine: { color: next.accent }, horzLine: { color: next.accent } },
      });
      candleSeries.applyOptions({ upColor: next.positive, wickUpColor: next.positive });
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    const resize = new ResizeObserver(() => chart.applyOptions({ width: mount.clientWidth }));
    resize.observe(mount);
    const crosshairHandler = (param: Parameters<IChartApi['subscribeCrosshairMove']>[0] extends (arg: infer A) => void ? A : never) => {
      if (!param.time) { setHover(null); return; }
      const time = typeof param.time === 'number' ? param.time : null;
      setHover(time === null ? null : candleDataRef.current.find((item) => item.time === time) ?? null);
    };
    chart.subscribeCrosshairMove(crosshairHandler);
    const fitHandler = () => chart.timeScale().fitContent();
    window.addEventListener('native-chart-fit', fitHandler);
    return () => {
      observer.disconnect();
      resize.disconnect();
      chart.unsubscribeCrosshairMove(crosshairHandler);
      window.removeEventListener('native-chart-fit', fitHandler);
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      seriesRef.current = [];
      hasChartDataRef.current = false;
      paneCountRef.current = 0;
      paneKeysRef.current = [];
      chart.remove();
      bundleRef.current = null;
    };
  }, []);

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
    const range = chart.timeScale().getVisibleLogicalRange();
    const previousWeights = new Map(paneKeysRef.current.map((key, index) =>
      [key, chart.panes()[index]?.getStretchFactor()] as const));
    if (bundle.primitive) candleSeries.detachPrimitive(bundle.primitive);
    // Recreate only the chart's series; the chart instance and shared viewport remain stable.
    for (const series of seriesRef.current) chart.removeSeries(series);
    seriesRef.current = [];
    candleSeries.applyOptions({ priceFormat: priceFormat(candles), visible: candles.length > 0 });
    candleSeries.setData(candles.map((bar) => ({ time: toTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close })));
    const pushSeries = (series: ISeriesApi<any>) => { seriesRef.current.push(series); return series; };
    const volumePane = showVolume ? 1 : null;
    if (showVolume) {
      const volumeSeries = pushSeries(chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' }, priceScaleId: '', lastValueVisible: false, priceLineVisible: false,
      }, 1));
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0 } });
      volumeSeries.setData(volumeCandles.map((bar) => ({
        time: toTime(bar.time), value: bar.volume, color: bar.close >= bar.open ? '#4e9c6870' : '#c76b6170',
      })));
      bundle.volumeSeries = volumeSeries;
    } else bundle.volumeSeries = null;

    const priceOverlay = (id: ChartStudyId, data: Array<{ time: number; value: number | null }>, color: string, width: number) => {
      if (!studies.includes(id) || !data.length) return;
      const line = pushSeries(chart.addSeries(LineSeries, { color, lineWidth: width as 1 | 2 | 3 | 4, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0));
      line.setData(data.filter((point): point is { time: number; value: number } => point.value !== null && Number.isFinite(point.value))
        .map((point) => ({ time: toTime(point.time), value: point.value })));
    };
    priceOverlay('ema', studyData.ema, '#e9ae62', 2);
    priceOverlay('sma', studyData.sma, '#75b6b0', 2);
    if (studies.includes('bb') && studyData.bb.middle.length) {
      for (const [data, color] of [[studyData.bb.upper, '#9b8cbe'], [studyData.bb.middle, '#8878ad'], [studyData.bb.lower, '#9b8cbe']] as const) {
        const line = pushSeries(chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0));
        line.setData(data.filter((point) => point.value !== null && Number.isFinite(point.value)).map((point) => ({ time: toTime(point.time), value: point.value! })));
      }
    }

    paneCountRef.current = 0;
    const nextPane = () => (volumePane === null ? 1 : 2) + paneCountRef.current++;
    if (studies.includes('rsi') && studyData.rsi.length) {
      const pane = nextPane();
      const rsi = pushSeries(chart.addSeries(LineSeries, {
        color: '#69a8c4', lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      }, pane));
      rsi.setData(studyData.rsi.filter((point) => point.value !== null).map((point) => ({ time: toTime(point.time), value: point.value! })));
      rsi.createPriceLine({ price: 70, color: '#c76b6170', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '70' });
      rsi.createPriceLine({ price: 30, color: '#4e9c6870', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '30' });
    }
    if (studies.includes('macd') && studyData.macd.histogram.length) {
      const pane = nextPane();
      const macdPriceFormat = priceFormat(candles);
      const hist = pushSeries(chart.addSeries(HistogramSeries, { priceFormat: macdPriceFormat, priceLineVisible: false, lastValueVisible: false }, pane));
      hist.setData(studyData.macd.histogram.filter((point) => point.value !== null).map((point) => ({
        time: toTime(point.time), value: point.value!, color: point.value! >= 0 ? '#4e9c688c' : '#c76b618c',
      })));
      hist.createPriceLine({ price: 0, color: '#89928a88', lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
      const line = pushSeries(chart.addSeries(LineSeries, { color: '#d5ad73', lineWidth: 1, priceFormat: macdPriceFormat, priceLineVisible: false, lastValueVisible: false }, pane));
      line.setData(studyData.macd.macd.filter((point) => point.value !== null).map((point) => ({ time: toTime(point.time), value: point.value! })));
      const signal = pushSeries(chart.addSeries(LineSeries, { color: '#729db4', lineWidth: 1, priceFormat: macdPriceFormat, priceLineVisible: false, lastValueVisible: false }, pane));
      signal.setData(studyData.macd.signal.filter((point) => point.value !== null).map((point) => ({ time: toTime(point.time), value: point.value! })));
    }
    if (funding) {
      const pane = nextPane();
      const threshold = funding.threshold;
      const fund = pushSeries(chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'price', precision: 4, minMove: 0.0001 }, priceLineVisible: false, lastValueVisible: false,
        autoscaleInfoProvider: (original) => {
          const info = original();
          return info ? { ...info, priceRange: {
            minValue: Math.min(info.priceRange.minValue, -threshold),
            maxValue: Math.max(info.priceRange.maxValue, threshold),
          } } : null;
        },
      }, pane));
      fund.setData(fundingRows.map((point) => point.value === null
        ? { time: point.time }
        : { ...point, color: point.value >= 0 ? '#c76b61b8' : '#4e9c68b8' }));
      fund.createPriceLine({ price: funding.threshold, color: '#c76b6180', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '+' });
      fund.createPriceLine({ price: -funding.threshold, color: '#4e9c6880', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '−' });
      fund.createPriceLine({ price: 0, color: '#89928a70', lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
    }
    const addCvdPane = (payload: CvdPayload | null, enabled: boolean, key: string) => {
      if (!enabled) return;
      const pane = nextPane();
      const series = pushSeries(chart.addSeries(CandlestickSeries, {
        priceFormat: { type: 'custom', formatter: compactCvd, minMove: 0.01 },
        upColor: '#4e9c68', downColor: '#c76b61', borderVisible: false,
        wickUpColor: '#4e9c68', wickDownColor: '#c76b61', priceLineVisible: false,
      }, pane));
      series.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.08 } });
      // Missing timestamps stay missing; cumulative values are never carried across gaps.
      series.setData((payload?.candles ?? []).map((bar) => ({
        time: toTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        color: bar.close >= bar.open ? '#4e9c68' : '#c76b61',
        wickColor: bar.close >= bar.open ? '#4e9c68' : '#c76b61',
        borderColor: bar.close >= bar.open ? '#4e9c68' : '#c76b61',
      })));
      series.applyOptions({ title: `${key === 'perpetual-cvd' ? 'Perpetual CVD' : 'Spot CVD'} · ${(payload?.anchor ?? '1w').toUpperCase()}` });
    };
    addCvdPane(perpetualCvd, perpetualCvdEnabled, 'perpetual-cvd');
    addCvdPane(spotCvd, spotCvdEnabled, 'spot-cvd');
    // Set proportions together after every pane exists. Sequential pixel-height
    // changes during add/remove can progressively squeeze sibling panes.
    const lowerPanes = [
      ...(showVolume ? [{ key: 'volume', height: 88 }] : []),
      ...(studies.includes('rsi') && studyData.rsi.length ? [{ key: 'rsi', height: 110 }] : []),
      ...(studies.includes('macd') && studyData.macd.histogram.length ? [{ key: 'macd', height: 130 }] : []),
      ...(funding ? [{ key: 'funding', height: 112 }] : []),
      ...(perpetualCvdEnabled ? [{ key: 'perpetual-cvd', height: 142 }] : []),
      ...(spotCvdEnabled ? [{ key: 'spot-cvd', height: 142 }] : []),
    ];
    const priceHeight = Math.max(260, (mountRef.current?.clientHeight ?? 650) -
      lowerPanes.reduce((sum, pane) => sum + pane.height, 0) - 30);
    const allocations = [{ key: 'price', height: priceHeight }, ...lowerPanes];
    chart.panes().forEach((pane, index) => {
      const allocation = allocations[index];
      if (!allocation) return;
      const previous = previousWeights.get(allocation.key);
      pane.setStretchFactor(previous && Number.isFinite(previous) ? previous : allocation.height);
    });
    paneKeysRef.current = allocations.map(pane => pane.key);
    if (zones.length) {
      const primitive = new LiquidityZonePrimitive({ series: candleSeries, timeScale: chart.timeScale(), zones, candles, style: zoneColors });
      candleSeries.attachPrimitive(primitive);
      bundle.primitive = primitive;
    } else bundle.primitive = null;
    chart.applyOptions({ timeScale: { timeVisible: true, secondsVisible: false } });
    if (candles.length) {
      const shouldFit = resetKeyRef.current !== resetKey || !hasChartDataRef.current;
      resetKeyRef.current = resetKey;
      hasChartDataRef.current = true;
      if (shouldFit) animationFrameRef.current = requestAnimationFrame(() => {
        chart.timeScale().fitContent();
        animationFrameRef.current = null;
      });
      else if (range) animationFrameRef.current = requestAnimationFrame(() => {
        chart.timeScale().setVisibleLogicalRange(range);
        animationFrameRef.current = null;
      });
    } else hasChartDataRef.current = false;
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [candles, volumeCandles, studies, studyData, zones, zoneColors, funding, fundingRows, showVolume, liquiditySettings, timeframe, resetKey, perpetualCvd, spotCvd, perpetualCvdEnabled, spotCvdEnabled]);

  return (
    <div className="native-chart-wrap">
      <div className="native-chart-readout" aria-live="polite">
        <span>{timeframe} · UTC</span>
        {hover ? <><b>O {hover.open.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</b><b>H {hover.high.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</b>
          <b>L {hover.low.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</b><b>C {hover.close.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</b>
          <span>V {volumeByTime.has(hover.time) ? volumeByTime.get(hover.time)!.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</span></> : <span>OHLC · move pointer over a candle</span>}
      </div>
      {insufficientStudies.length > 0 && <div className="native-study-warmup" role="status">
        <strong>Insufficient history for selected studies</strong><span>{insufficientStudies.join(' · ')}</span>
      </div>}
      <div className="native-chart-canvas" ref={mountRef} role="img" aria-label="Native exchange-fed candlestick chart with synchronized indicator panes" />
      <div className="native-chart-legend"><span><i className="legend-candle" /> Candles / selected venue OHLC</span>
        {showVolume && <span><i className="legend-volume" /> Volume</span>}{studies.includes('ema') && <span><i className="legend-ema" /> EMA</span>}
        {studies.includes('sma') && <span><i className="legend-sma" /> SMA</span>}{studies.includes('bb') && <span><i className="legend-bb" /> Bollinger</span>}
        {studies.includes('rsi') && <span>RSI · 30 / 70</span>}{studies.includes('macd') && <span>MACD</span>}{funding && <span>Funding · normalized 8h</span>}
         {perpetualCvdEnabled && <span>Perpetual CVD · signed trade flow</span>}{spotCvdEnabled && <span>Spot CVD · signed trade flow</span>}
      </div>
    </div>
  );
}

