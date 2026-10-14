import test from "node:test";
import assert from "node:assert/strict";
import { createFundingIndicatorService } from "./fundingIndicator.js";
import { readFileSync } from "node:fs";

function setup() {
  let clock = Date.UTC(2026, 9, 14, 12);
  const calls = [];
  const inventory = () => Object.fromEntries(["binance", "bybit", "bitmex"].map((exchange, i) => [exchange, {
    running: false, readings: [{ exchange, asset: "BTC", exchangeAsset: "BTC", symbol: exchange === "bitmex" ? "XBTUSD" : "BTCUSDT",
      ratePct: [0.01, -0.02, 0.003][i], oiUsd: [100, 300, 5][i], intervalHours: 8, fetchedAt: clock, listedAt: 0 }],
  }]));
  const fetchHistory = async (_request, item, from, to) => {
    calls.push({ exchange: item.exchange, from, to });
    const points = [];
    for (let timestamp = Math.ceil(from / 28800000) * 28800000; timestamp <= to; timestamp += 28800000)
      points.push({ timestamp, ratePct: item.ratePct });
    return { from, to, points, complete: true };
  };
  const service = createFundingIndicatorService({ inventory, fetchHistory, request: async () => {}, gates: {},
    now: () => clock, storageDir: null, timers: false });
  return { service, calls, advance: ms => { clock += ms; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test("live feed returns all three methods immediately and loads settled history progressively", async () => {
  const f = setup();
  const first = f.service.get({ asset: "BTC" });
  assert.equal(first.current.sourceCount, 3);
  assert.equal(first.basis, "normalized8h");
  assert.equal(first.observations.points.length, 1);
  assert.equal(first.history.isLoading, true);
  assert.equal(first.sources.find(source => source.exchange === "bitmex").historyStatus, "unavailable");
  await settle();
  const second = f.service.get({ asset: "BTC" });
  assert.equal(second.history.sourcesReady, 2);
  assert.ok(second.history.points.some(point => point.meanPct === -0.005));
  assert.ok(second.history.points.every(point => !("weightedPct" in point)));
  assert.equal(f.calls.length, 2);
});

test("refresh, timeframe changes and mode-local calculation reuse settled requests; new periods fetch only missing range", async () => {
  const f = setup();
  f.service.get({ asset: "BTC" }); await settle();
  f.service.get({ asset: "BTC", timeframe: "5m" }); f.service.get({ asset: "BTC" });
  assert.equal(f.calls.length, 2);
  const lastTo = f.calls[0].to;
  f.advance(3600000);
  f.service.get({ asset: "BTC" }); await settle();
  assert.equal(f.calls.length, 4);
  assert.ok(f.calls.slice(2).every(call => call.from === lastTo));
});

test("recorded live OI history starts at observation time, does not invent historical weights", async () => {
  const f = setup(); const first = f.service.get({ asset: "BTC", timeframe: "5m" });
  assert.equal(first.observations.points.length, 1);
  f.advance(300000); const second = f.service.get({ asset: "BTC", timeframe: "5m" });
  assert.equal(second.observations.points.length, 2);
  assert.ok(second.observations.points.every(point => point.weightedPct === first.current.weightedPct));
  assert.equal(second.observations.startedAt, new Date(first.current.time * 1000).toISOString());
});

test("unknown history does not fetch, while verified history observes cooldown and failure backoff", async () => {
  let calls = 0;
  const time = Date.UTC(2026, 9, 14);
  const makeState = exchange => ({ running: false, readings: [{ exchange, asset: "BTC", symbol: "BTCUSDT",
    oiUsd: 100, ratePct: 0.01, intervalHours: 8, fetchedAt: time }] });
  const service = createFundingIndicatorService({ inventory: () => ({ bybit: makeState("bybit"), bitmex: makeState("bitmex") }),
    fetchHistory: async () => { calls++; throw new Error("private upstream error"); }, request: async () => {},
    gates: {}, now: () => time, storageDir: null, timers: false });
  service.get({ asset: "BTC" }); await settle();
  const data = service.get({ asset: "BTC" });
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(data).includes("private"));
  const paused = createFundingIndicatorService({ inventory: () => ({ bybit: makeState("bybit") }),
    fetchHistory: async () => { calls++; }, gates: { bybit: { isCoolingDown: true } },
    now: () => time, storageDir: null, timers: false });
  paused.get({ asset: "BTC" });
  assert.equal(calls, 1);
});

test("native chart combines Liquidity Zones and funding without a hosted widget", () => {
  const picker = readFileSync(new URL("../src/pages/super-charts-page.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/components/native-chart-workspace.tsx", import.meta.url), "utf8");
  assert.match(picker, /Liquidity Zones/);
  assert.match(picker, /Aggregated Funding Rate/);
  assert.match(picker, /<NativeChartWorkspace/);
  assert.match(ui, /useCoinChartSetting\(asset, 'fundingThreshold', 0\.08\)/);
  assert.match(ui, /props\.method === 'weighted' \? 'recordedLive'/);
  assert.match(ui, /8-hour/);
  assert.match(ui, /payload\.historyWindow === props\.window/);
  const hook = readFileSync(new URL("../src/hooks/use-funding-indicator.ts", import.meta.url), "utf8");
  assert.match(hook, /historyWindow: FundingIndicatorWindow/);
  assert.doesNotMatch(hook, /window: FundingIndicatorWindow/);
  const chart = readFileSync(new URL("../src/components/funding-indicator-chart.tsx", import.meta.url), "utf8");
  assert.match(chart, /time: point\.time as UTCTimestamp/);
  assert.match(chart, /\? \{ time: point\.time as UTCTimestamp \}/);
});
