import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { CHART_STUDIES, SUPER_CHART_TIMEFRAMES } from "../src/lib/supercharts.ts";

const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("native chart exposes five locally calculated studies and six shared timeframes", () => {
  assert.deepEqual(CHART_STUDIES.map(item => item.id), ["rsi", "macd", "ema", "sma", "bb"]);
  assert.deepEqual(SUPER_CHART_TIMEFRAMES.map(item => item.value), ["5m", "15m", "30m", "1h", "4h", "24h"]);
  assert.ok(CHART_STUDIES.every(item => !Object.hasOwn(item, "widgetId")));
});

test("Super Charts routes to a single native workspace, not a hosted widget or independent plots", () => {
  const app = read("App.tsx");
  const page = read("pages/super-charts-page.tsx");
  assert.match(app, /path="\/super-charts" component=\{SuperChartsPage\}/);
  assert.match(page, /<AppHeader/);
  assert.match(page, /mark="SC"/);
  assert.match(page, /Technical Indicators/);
  assert.match(page, /Orderflow Indicators/);
  assert.match(page, /aria-expanded/);
  assert.match(page, /aria-pressed/);
  assert.match(page, /<MarketAutocomplete/);
  assert.equal((page.match(/<NativeChartWorkspace /g) ?? []).length, 1);
  assert.doesNotMatch(page, /SuperChartWidget|<OrderflowIndicators|<AggregatedFundingIndicator|<iframe|tradingview/i);
  assert.ok(!existsSync(new URL("../src/components/super-chart-widget.tsx", import.meta.url)));
});

test("technical and custom layers use one chart API with shared timeline, cleanup and attribution", () => {
  const renderer = read("components/native-super-chart.tsx");
  assert.equal((renderer.match(/createChart\(/g) ?? []).length, 1);
  for (const feature of ["CandlestickSeries", "HistogramSeries", "LineSeries", "LiquidityZonePrimitive",
    "calculateTechnicalIndicators", "subscribeCrosshairMove", "getVisibleLogicalRange", "setVisibleLogicalRange",
    "MutationObserver", "ResizeObserver", "chart.remove()"]) assert.ok(renderer.includes(feature), feature);
  assert.match(renderer, /attributionLogo: true/);
  assert.match(renderer, /volumeSeries\.priceScale\(\)\.applyOptions/);
  assert.match(renderer, /minValue: 0, maxValue: 100/);
  assert.match(renderer, /precision: 4/);
  assert.match(renderer, /getStretchFactor/);
  assert.match(renderer, /setStretchFactor/);
  assert.match(renderer, /point\.time >= start && point\.time <= end/);
  assert.match(renderer, /point\.value === null/);
  assert.doesNotMatch(renderer, /fetch\(|<iframe|embed-widget/);
});

test("native workspace retains valid prices when aggregate volume is missing and avoids disabled feeds", () => {
  const workspace = read("components/native-chart-workspace.tsx");
  assert.ok((workspace.match(/useLiquidityCandles\(/g) ?? []).length >= 2);
  assert.match(workspace, /volumeCandles=/);
  assert.match(workspace, /<FundingEnabledWorkspace/);
  assert.match(workspace, /enabled=\{hasFunding\}/);
  assert.match(workspace, /'recordedLive'/);
  assert.match(workspace, /weightedFallback/);
  assert.doesNotMatch(workspace, /\bfeedVolume\b|\bcandlesFeed\b|\bcurrentCandlesPayload\b/);
  for (const hook of ["hooks/use-funding-indicator.ts", "hooks/use-liquidity-candles.ts"]) {
    const source = read(hook);
    assert.match(source, /enabled = true/);
    assert.match(source, /if \(!enabled\)/);
    assert.match(source, /AbortController/);
    assert.match(source, /clearTimeout/);
  }
});
