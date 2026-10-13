import test from "node:test";
import assert from "node:assert/strict";
import { createAggregatedCandleService } from "./aggregatedChartCandles.js";

const start = 1750000800;
const bars = (volume, count = 1000) => Array.from({ length: count }, (_, i) => ({
  time: start + i * 3600, open: 2, high: 3, low: 1, close: 2, volume, closed: true,
}));
const rawOkx = count => bars(7, count).reverse().map(bar => [
  String(bar.time * 1000), "2", "3", "1", "2", "999", "7", "888", "1",
]);
function fixture(options = {}) {
  let clock = (start + 1001 * 3600) * 1000;
  const calls = [], singleCalls = [];
  const single = { get: async query => {
    singleCalls.push(query);
    return { exchange: query.exchange, symbol: query.symbol, timeframe: query.timeframe,
      candles: bars(query.exchange === "binance" ? 10 : 0.02), stale: false, fetchedAt: new Date(clock).toISOString() };
  } };
  const request = async url => {
    calls.push(url); const u = new URL(url);
    if (options.failOkx && u.hostname.includes("okx")) throw new Error("secret upstream details");
    if (url.includes("instruments-info")) return { result: { list: [
      { symbol: "1000PEPEUSDT", baseCoin: "1000PEPE", status: "Trading", contractType: "LinearPerpetual", quoteCoin: "USDT" },
    ] } };
    if (url.includes("public/instruments")) return { data: [
      { instId: "PEPE-USDT-SWAP", ctValCcy: "PEPE", ctType: "linear", settleCcy: "USDT", state: "live" },
    ] };
    if (url.endsWith("contracts")) return [
      { name: "PEPE_USDT", quanto_multiplier: "0.01", in_delisting: false },
    ];
    if (url.includes("gateio") && url.includes("candlesticks")) return bars(3).map(bar => ({
      t: bar.time, o: "2", h: "3", l: "1", c: "2", v: 300, sum: "999",
    }));
    if (url.includes("history-candles")) {
      const after = Number(u.searchParams.get("after"));
      return { data: rawOkx(1000).filter(row => Number(row[0]) < after).slice(0, 300) };
    }
    if (url.includes("market/candles")) return { data: rawOkx(1000).slice(0, 300) };
    throw new Error(`Unexpected fixture URL: ${url}`);
  };
  return { service: createAggregatedCandleService({ single, request, gates: {}, now: () => clock }),
    calls, singleCalls, advance: ms => { clock += ms; } };
}
const query = { exchange: "binance", symbol: "PEPEUSDT", timeframe: "1h", volumeMode: "aggregated" };

test("all four venue volumes align, multiplier contracts merge, and price is not aggregated", async () => {
  const f = fixture(); const result = await f.service.get(query);
  assert.equal(result.volumeAsset, "PEPE");
  assert.equal(result.candles.length, 1000);
  assert.equal(result.candles[0].volume, 40); // 10 + 7 + 3 + (0.02 * 1000)
  assert.equal(result.candles[0].close, 2);
  assert.equal(result.partialVolume, false);
  assert.equal(result.volumeSources.filter(source => source.status === "ok").length, 4);
  assert.ok(f.singleCalls.some(call => call.symbol === "1000PEPEUSDT" && call.exchange === "bybit"));
  assert.equal(f.calls.filter(url => url.includes("history-candles")).length, 3);
});

test("refresh is cached/coalesced, metadata retained, and OKX older pages reused", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.service.get(query), f.service.get(query)]);
  assert.equal(a, b);
  const count = f.calls.length;
  await f.service.get(query); assert.equal(f.calls.length, count);
  f.advance(31000); await f.service.get(query);
  assert.equal(f.calls.filter(url => url.includes("history-candles")).length, 3);
  assert.equal(f.calls.filter(url => url.includes("public/instruments")).length, 1);
  assert.equal(f.calls.filter(url => url.includes("instruments-info")).length, 1);
});

test("failed exchange is disclosed and excluded for the entire series, with failure backoff", async () => {
  const f = fixture({ failOkx: true });
  const data = await f.service.get(query);
  assert.equal(data.partialVolume, true);
  assert.equal(data.candles[0].volume, 33);
  assert.equal(data.volumeSources.find(source => source.exchange === "okx").status, "unavailable");
  assert.ok(!JSON.stringify(data).includes("secret"));
  f.advance(31000); await f.service.get(query);
  assert.equal(f.calls.filter(url => url.includes("okx")).length, 1);
});

test("single mode preserves the original feed and no other exchange requests; invalid mode is rejected", async () => {
  const f = fixture();
  const single = await f.service.get({ ...query, volumeMode: "single" });
  assert.equal(single.candles[0].volume, 10);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.service.get({ ...query, volumeMode: "wrong" }), /volumeMode/);
  await assert.rejects(f.service.get({ ...query, volumeMode: ["aggregated"] }), /volumeMode/);
});
