import { useEffect, useRef } from 'react';
import {
  BaselineSeries,
  ColorType,
  createChart,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { FundingIndicatorPoint } from '@/hooks/use-funding-indicator';

type Props = { points: FundingIndicatorPoint[]; seriesKey: 'meanPct' | 'medianPct' | 'weightedPct'; thresholdPct: number };
type Bundle = { chart: IChartApi; series: ISeriesApi<'Baseline'>; lines: ReturnType<ISeriesApi<'Baseline'>['createPriceLine']>[] };

function palette(element: HTMLElement) {
  const styles = getComputedStyle(element);
  return {
    surface: styles.getPropertyValue('--lsar-surface').trim() || '#f8f6ef',
    muted: styles.getPropertyValue('--lsar-muted').trim() || '#7b8780',
    ink: styles.getPropertyValue('--lsar-ink').trim() || '#27383b',
    border: styles.getPropertyValue('--lsar-border').trim() || '#d9d5c9',
    accent: styles.getPropertyValue('--lsar-accent').trim() || '#287465',
  };
}

function mapPoint(point: FundingIndicatorPoint, seriesKey: Props['seriesKey']) {
  const value = point[seriesKey];
  return value === null || value === undefined || !Number.isFinite(value)
    ? { time: point.time as UTCTimestamp }
    : { time: point.time as UTCTimestamp, value };
}

export function FundingIndicatorChart({ points, seriesKey, thresholdPct }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const bundleRef = useRef<Bundle | null>(null);
  const pointsRef = useRef(points);
  const thresholdRef = useRef(thresholdPct);
  pointsRef.current = points;
  thresholdRef.current = thresholdPct;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const colors = palette(mount);
    const chart = createChart(mount, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: colors.surface }, textColor: colors.muted, fontFamily: 'var(--app-font-mono), monospace', attributionLogo: true },
      grid: { vertLines: { color: colors.border }, horzLines: { color: colors.border } },
      rightPriceScale: { borderColor: colors.border, scaleMargins: { top: 0.15, bottom: 0.15 } },
      timeScale: { borderColor: colors.border, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: colors.accent }, horzLine: { color: colors.accent } },
      localization: { locale: 'en-US', priceFormatter: (value: number) => `${value.toFixed(4)}%` },
    });
    const series = chart.addSeries(BaselineSeries, {
      autoscaleInfoProvider: (original) => {
        const info = original();
        if (!info) return null;
        return { ...info, priceRange: {
          minValue: Math.min(info.priceRange.minValue, -thresholdRef.current),
          maxValue: Math.max(info.priceRange.maxValue, thresholdRef.current),
        } };
      },
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#c75a52',
      topFillColor1: 'rgba(199,90,82,0.20)',
      topFillColor2: 'rgba(199,90,82,0.015)',
      bottomLineColor: '#25876a',
      bottomFillColor1: 'rgba(37,135,106,0.015)',
      bottomFillColor2: 'rgba(37,135,106,0.18)',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (value: number) => `${value.toFixed(4)}%`, minMove: 0.0001 },
      lastValueVisible: true,
      priceLineVisible: false,
    });
    const lines: Bundle['lines'] = [];
    const applyThresholdLines = () => {
      const threshold = thresholdRef.current;
      series.setData(pointsRef.current.map((point) => mapPoint(point, seriesKey)));
      lines.forEach((line) => series.removePriceLine(line));
      lines.splice(0, lines.length,
        series.createPriceLine({ price: threshold, color: '#c75a52', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `+${threshold.toFixed(2)}%` }),
        series.createPriceLine({ price: -threshold, color: '#25876a', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `−${threshold.toFixed(2)}%` }),
        series.createPriceLine({ price: 0, color: colors.ink, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '0' }),
      );
    };
    applyThresholdLines();
    bundleRef.current = { chart, series, lines };
    if (pointsRef.current.length) chart.timeScale().fitContent();

    const observer = new MutationObserver(() => {
      const next = palette(mount);
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: next.surface }, textColor: next.muted },
        grid: { vertLines: { color: next.border }, horzLines: { color: next.border } },
        rightPriceScale: { borderColor: next.border },
        timeScale: { borderColor: next.border },
        crosshair: { vertLine: { color: next.accent }, horzLine: { color: next.accent } },
      });
      bundleRef.current?.lines.forEach((line) => bundleRef.current?.series.removePriceLine(line));
      const lines = bundleRef.current?.lines;
      if (lines) {
        lines.splice(0, lines.length,
          series.createPriceLine({ price: thresholdRef.current, color: '#c75a52', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `+${thresholdRef.current.toFixed(2)}%` }),
          series.createPriceLine({ price: -thresholdRef.current, color: '#25876a', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `−${thresholdRef.current.toFixed(2)}%` }),
          series.createPriceLine({ price: 0, color: next.ink, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '0' }),
        );
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => { observer.disconnect(); chart.remove(); bundleRef.current = null; };
  }, [seriesKey]);

  useEffect(() => {
    const bundle = bundleRef.current;
    if (!bundle) return;
    bundle.series.applyOptions({ pointMarkersVisible: points.filter(point => Number.isFinite(point[seriesKey]) && point[seriesKey] !== null).length === 1 });
    bundle.series.setData(points.map((point) => mapPoint(point, seriesKey)));
  }, [points, seriesKey]);

  useEffect(() => {
    const bundle = bundleRef.current;
    if (!bundle) return;
    bundle.lines.forEach((line) => bundle.series.removePriceLine(line));
    const colors = palette(mountRef.current!);
    bundle.lines.splice(0, bundle.lines.length,
      bundle.series.createPriceLine({ price: thresholdPct, color: '#c75a52', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `+${thresholdPct.toFixed(2)}%` }),
      bundle.series.createPriceLine({ price: -thresholdPct, color: '#25876a', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `−${thresholdPct.toFixed(2)}%` }),
      bundle.series.createPriceLine({ price: 0, color: colors.ink, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '0' }),
    );
  }, [thresholdPct]);

  return <div ref={mountRef} className="funding-indicator-chart-canvas" role="img" aria-label="Aggregate funding rate history chart, positive rates red and negative rates green" />;
}
