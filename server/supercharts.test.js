import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAdvancedChartConfig, buildChartSymbol, normalizePerpetualTicker,
  CHART_EXCHANGES, CHART_INTERVALS, CHART_STUDIES,
} from "../src/lib/supercharts.ts";

const options = {
  exchange: "BINANCE", ticker: "BTCUSDT", interval: "60",
  theme: "dark", studies: ["rsi"],
};

test("charts use perpetual symbols, preserving exchange multiplier prefixes", () => {
  assert.equal(buildChartSymbol("BINANCE", " btcusdt.p "), "BINANCE:BTCUSDT.P");
  assert.equal(buildChartSymbol("BYBIT", "1000PEPEUSDT"), "BYBIT:1000PEPEUSDT.P");
  assert.equal(buildChartSymbol("OKX", "ETHUSDT"), "OKX:ETHUSDT.P");
  assert.equal(normalizePerpetualTicker(""), "BTCUSDT");
  assert.equal(CHART_EXCHANGES.length, 7);
  assert.equal(buildChartSymbol("GATEIO", "BTCUSDT"), "GATEIO:BTCUSDT.P");
  assert.deepEqual(new Set(CHART_EXCHANGES.map(exchange => exchange.id)),
    new Set(["BINANCE", "BYBIT", "OKX", "GATEIO", "MEXC", "BITGET", "BINGX"]));
});

test("chart config includes only selected studies and changes theme and timeframe", () => {
  const config = buildAdvancedChartConfig(options);
  assert.deepEqual(config.studies, ["RSI@tv-basicstudies"]);
  assert.equal(config.theme, "dark");
  assert.equal(config.symbol, "BINANCE:BTCUSDT.P");
  assert.equal(config.autosize, true);
  assert.equal(config.allow_symbol_change, true);
  assert.equal(config.hide_side_toolbar, false);
  assert.equal(config.hide_top_toolbar, false);
  const changed = buildAdvancedChartConfig({
    ...options, theme: "light", interval: "240", studies: ["macd", "ema", "sma", "bb"],
  });
  assert.equal(changed.theme, "light");
  assert.equal(changed.interval, "240");
  assert.deepEqual(changed.studies, CHART_STUDIES.slice(1).map(study => study.widgetId));
  assert.deepEqual(buildAdvancedChartConfig({ ...options, studies: [] }).studies, []);
  assert.deepEqual(CHART_INTERVALS.map(item => item.label), ["5m", "15m", "30m", "1h", "4h", "1D"]);
});

test("Super Charts keeps the hosted chart above multiple custom panels and uses dropdown indicator menus", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/pages/super-charts-page.tsx", import.meta.url), "utf8");
  assert.match(app, /path="\/super-charts" component=\{SuperChartsPage\}/);
  assert.match(app, /module\.path !== '\/super-charts'/);
  assert.match(page, /<AppHeader/);
  assert.match(page, /mark="SC"/);
  assert.match(page, /Technical Indicators/);
  assert.match(page, /Orderflow Indicators/);
  assert.match(page, /aria-expanded/);
  assert.match(page, /aria-pressed/);
  assert.match(page, /<SuperChartWidget/);
  assert.match(page, /indicators\.map/);
  assert.match(page, /<OrderflowIndicators/);
  assert.match(page, /<AggregatedFundingIndicator/);
  assert.ok(page.indexOf("<SuperChartWidget") < page.indexOf("<OrderflowIndicators"));
  assert.doesNotMatch(page, /type="checkbox"|aria-label="Chart timeframe"|aria-label="Exchange"/);
  assert.match(page, /<MarketAutocomplete/);
});

test("widget uses official embedding, theme observation and cleanup without scraping market data", () => {
  const widget = readFileSync(new URL("../src/components/super-chart-widget.tsx", import.meta.url), "utf8");
  assert.match(widget, /https:\/\/s3\.tradingview\.com\/external-embedding\/embed-widget-advanced-chart\.js/);
  assert.match(widget, /tradingview-widget-container/);
  assert.match(widget, /JSON\.stringify\(config\)/);
  assert.match(widget, /attributeFilter: \['data-theme'\]/);
  assert.match(widget, /observer\.disconnect/);
  assert.match(widget, /mount\.replaceChildren/);
  assert.match(widget, /HTMLIFrameElement/);
  assert.match(widget, /TradingView/);
  assert.doesNotMatch(widget, /fetch\(|WebSocket\(/);
  const css = readFileSync(new URL("../src/styles/super-charts.css", import.meta.url), "utf8");
  // The official embed overwrites its parent with an inline height:100%.
  // A concrete responsive height must win or the chart collapses to 150px.
  assert.match(css, /\.super-chart-mount \{ height:min\(68vh,720px\) !important/);
  assert.match(css, /\.super-chart-mount \{ height:62vh !important/);
});
