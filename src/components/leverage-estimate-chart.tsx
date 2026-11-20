import { useEffect, useRef } from 'react';
import {
  ColorType, createChart, HistogramSeries, LineSeries, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import type { LeverageRow } from '@/hooks/use-leverage-estimate';

const LONG = '#25876a', SHORT = '#c75a52', SCORE = '#b8862f';

function palette(element: HTMLElement) {
  const styles = getComputedStyle(element);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    surface: read('--lsar-surface', '#f8f6ef'), muted: read('--lsar-muted', '#7b8780'),
    ink: read('--lsar-ink', '#27383b'), border: read('--lsar-border', '#d9d5c9'), accent: read('--lsar-accent', '#287465'),
  };
}

type Bundle = {
  chart: IChartApi; score: ISeriesApi<'Line'>; pressure: ISeriesApi<'Line'>;
  build: ISeriesApi<'Histogram'>; price: ISeriesApi<'Line'>;
};

const point = (time: number, value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? { time: Math.floor(time / 1000) as UTCTimestamp }
    : { time: Math.floor(time / 1000) as UTCTimestamp, value };

const compactUsd = (value: number) => {
  const abs = Math.abs(value), sign = value < 0 ? '−' : '';
  return abs >= 1e9 ? `${sign}$${(abs / 1e9).toFixed(2)}B` : abs >= 1e6 ? `${sign}$${(abs / 1e6).toFixed(1)}M`
    : abs >= 1e3 ? `${sign}$${(abs / 1e3).toFixed(0)}K` : `${sign}$${abs.toFixed(0)}`;
};

function setData(bundle: Bundle, rows: LeverageRow[]) {
  bundle.score.setData(rows.map(row => point(row.time, row.leverageScore)));
  bundle.pressure.setData(rows.map(row => point(row.time, row.pressureIndex)));
  bundle.price.setData(rows.map(row => point(row.time, row.price)));
  // Net leveraged build per bar: long-side build/unwind minus short-side build/unwind.
  bundle.build.setData(rows.map(row => {
    const value = row.longBuildUsd - row.shortBuildUsd;
    return { time: Math.floor(row.time / 1000) as UTCTimestamp, value, color: value >= 0 ? `${LONG}cc` : `${SHORT}cc` };
  }));
}

export function LeverageEstimateChart({ rows }: { rows: LeverageRow[] }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const bundleRef = useRef<Bundle | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const colors = palette(mount);
    const chart = createChart(mount, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: colors.surface }, textColor: colors.muted,
        fontFamily: 'var(--app-font-mono), monospace', attributionLogo: true, panes: { separatorColor: colors.border } },
      grid: { vertLines: { color: colors.border }, horzLines: { color: colors.border } },
      rightPriceScale: { borderColor: colors.border },
      leftPriceScale: { visible: true, borderColor: colors.border },
      timeScale: { borderColor: colors.border, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: colors.accent }, horzLine: { color: colors.accent } },
    });
    const price = chart.addSeries(LineSeries, {
      color: colors.muted, lineWidth: 1, priceScaleId: 'left', title: 'Price', lastValueVisible: false, priceLineVisible: false,
      priceFormat: { type: 'custom', minMove: 0.00000001, formatter: (value: number) => {
        const abs = Math.abs(value);
        return abs >= 1000 ? value.toLocaleString('en-US', { maximumFractionDigits: 0 })
          : abs >= 1 ? value.toFixed(2) : value.toPrecision(4);
      } },
    }, 0);
    const score = chart.addSeries(LineSeries, {
      color: SCORE, lineWidth: 2, title: 'Leverage score', priceLineVisible: false,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      priceFormat: { type: 'custom', formatter: (value: number) => value.toFixed(0), minMove: 1 },
    }, 0);
    for (const [level, title] of [[80, 'Extreme'], [60, 'Elevated'], [40, 'Normal']] as const)
      score.createPriceLine({ price: level, color: colors.border, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title });
    const pressure = chart.addSeries(LineSeries, {
      color: colors.accent, lineWidth: 2, title: 'OI/spot pressure (100 = median)', priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: (value: number) => value.toFixed(0), minMove: 1 },
    }, 1);
    pressure.createPriceLine({ price: 100, color: colors.ink, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'median' });
    const build = chart.addSeries(HistogramSeries, {
      title: 'Net leveraged build', priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: compactUsd, minMove: 1 },
    }, 2);
    const panes = chart.panes();
    panes[0]?.setStretchFactor(2.2); panes[1]?.setStretchFactor(1); panes[2]?.setStretchFactor(1);
    const bundle = { chart, score, pressure, build, price };
    bundleRef.current = bundle;
    setData(bundle, rowsRef.current);
    chart.timeScale().fitContent();

    const observer = new MutationObserver(() => {
      const next = palette(mount);
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: next.surface }, textColor: next.muted, panes: { separatorColor: next.border } },
        grid: { vertLines: { color: next.border }, horzLines: { color: next.border } },
        rightPriceScale: { borderColor: next.border }, leftPriceScale: { borderColor: next.border },
        timeScale: { borderColor: next.border },
        crosshair: { vertLine: { color: next.accent }, horzLine: { color: next.accent } },
      });
      price.applyOptions({ color: next.muted });
      pressure.applyOptions({ color: next.accent });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => { observer.disconnect(); chart.remove(); bundleRef.current = null; };
  }, []);

  useEffect(() => {
    if (bundleRef.current) setData(bundleRef.current, rows);
  }, [rows]);

  return <div ref={mountRef} className="lev-chart-canvas" role="img"
    aria-label="Leverage score with price, OI to spot turnover pressure, and net leveraged long or short build per bar" />;
}
