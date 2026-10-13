import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, LiquidityZone } from '@/lib/liquidity-zones';
import { LiquidityZonePrimitive } from '@/components/liquidity-zone-primitive';

type Props = {
  candles: Candle[];
  zones: LiquidityZone[];
  showVolume: boolean;
  colors: { resistance: string; support: string; inside: string; transparency: number };
};

type ChartBundle = {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  primitive: LiquidityZonePrimitive;
};

function themeColors(element: HTMLElement) {
  const styles = getComputedStyle(element);
  const page = styles.getPropertyValue('--lsar-page').trim() || '#101411';
  const surface = styles.getPropertyValue('--lsar-surface').trim() || '#171c18';
  const muted = styles.getPropertyValue('--lsar-muted').trim() || '#929b92';
  const border = styles.getPropertyValue('--lsar-border').trim() || '#303831';
  const accent = styles.getPropertyValue('--lsar-accent').trim() || '#a6c69a';
  const positive = styles.getPropertyValue('--lsar-positive').trim() || '#4e9c68';
  return { page, surface, muted, border, accent, positive };
}

function priceFormat(candles: Candle[]) {
  const value = candles.at(-1)?.close ?? 1;
  const precision = Math.min(12, value < 1 ? Math.max(2, Math.ceil(-Math.log10(value)) + 2) : 2);
  return { type: 'price' as const, precision, minMove: 10 ** -precision };
}

export function LiquidityZoneChart({ candles, zones, showVolume, colors }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const bundleRef = useRef<ChartBundle | null>(null);
  const candlesRef = useRef(candles);
  const zonesRef = useRef(zones);
  const colorsRef = useRef(colors);
  const showVolumeRef = useRef(showVolume);
  candlesRef.current = candles;
  zonesRef.current = zones;
  colorsRef.current = colors;
  showVolumeRef.current = showVolume;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const colorsTheme = themeColors(mount);
    const chart = createChart(mount, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: colorsTheme.surface },
        textColor: colorsTheme.muted,
        fontFamily: 'var(--app-font-mono), monospace',
        attributionLogo: true,
      },
      grid: { vertLines: { color: colorsTheme.border }, horzLines: { color: colorsTheme.border } },
      rightPriceScale: { borderColor: colorsTheme.border, scaleMargins: { top: 0.12, bottom: 0.2 } },
      timeScale: { borderColor: colorsTheme.border, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: colorsTheme.accent }, horzLine: { color: colorsTheme.accent } },
      localization: { locale: 'en-US' },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      priceFormat: priceFormat(candlesRef.current),
      upColor: colorsTheme.positive,
      downColor: '#d15f57',
      borderVisible: false,
      wickUpColor: colorsTheme.positive,
      wickDownColor: '#d15f57',
      priceLineVisible: false,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const primitive = new LiquidityZonePrimitive({
      series: candleSeries,
      timeScale: chart.timeScale(),
      zones: zonesRef.current,
      candles: candlesRef.current,
      style: colorsRef.current,
    });
    candleSeries.attachPrimitive(primitive);
    bundleRef.current = { chart, candles: candleSeries, volume: volumeSeries, primitive };
    let firstData = true;
    const populate = () => {
      const rows = candlesRef.current;
      if (!rows.length) return;
      candleSeries.setData(rows.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })));
      volumeSeries.setData(rows.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        color: candle.close >= candle.open ? `${colorsTheme.positive}70` : '#d15f5770',
      })));
      volumeSeries.applyOptions({ visible: showVolumeRef.current });
      primitive.update({ series: candleSeries, timeScale: chart.timeScale(), zones: zonesRef.current, candles: rows, style: colorsRef.current });
      if (firstData) {
        chart.timeScale().fitContent();
        firstData = false;
      }
    };
    populate();
    const root = document.documentElement;
    const themeObserver = new MutationObserver(() => {
      const palette = themeColors(mount);
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: palette.surface }, textColor: palette.muted },
        grid: { vertLines: { color: palette.border }, horzLines: { color: palette.border } },
        rightPriceScale: { borderColor: palette.border },
        timeScale: { borderColor: palette.border },
        crosshair: { vertLine: { color: palette.accent }, horzLine: { color: palette.accent } },
      });
      candleSeries.applyOptions({
        upColor: palette.positive, wickUpColor: palette.positive,
      });
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => {
      themeObserver.disconnect();
      candleSeries.detachPrimitive(primitive);
      chart.remove();
      bundleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const bundle = bundleRef.current;
    if (!bundle || !candles.length) return;
    bundle.candles.applyOptions({ priceFormat: priceFormat(candles) });
    bundle.candles.setData(candles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })));
    bundle.volume.setData(candles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      value: candle.volume,
      color: candle.close >= candle.open ? '#4e9c6870' : '#d15f5770',
    })));
    bundle.primitive.update({ series: bundle.candles, timeScale: bundle.chart.timeScale(), zones, candles, style: colors });
  }, [candles, zones, colors]);

  useEffect(() => {
    bundleRef.current?.volume.applyOptions({ visible: showVolume });
  }, [showVolume]);

  return <div ref={mountRef} className="liquidity-chart-canvas" role="img" aria-label="Candlestick chart with calculated liquidity zones" />;
}
