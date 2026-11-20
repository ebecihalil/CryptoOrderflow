import test from "node:test";
import assert from "node:assert/strict";
import { fetchTopBinance, fetchTopOkx, fetchTopGate } from "./topTraderLsarMarketData.js";
import { createLsarCollector, createRows } from "./lsarMarketData.js";
import { BinanceRequestGate } from "./binanceRequestGate.js";

const now = Math.floor(Date.now() / 300_000) * 300_000;
const base = (exchange, extra = {}) => ({
  exchange, symbol: "BTCUSDT", asset: "BTC", exchangeAsset: "BTC", price: 60_000, priceChange24hPct: 1,
  openInterestUsd: 1_000_000, points: [{ timestamp: now, ratio: 1 }], ...extra,
});

test("Binance top trader reuses global contracts/OI and requests the right endpoint per product", async () => {
  const urls = [];
  const published = [];
  const source = () => [base("binance"), base("binance", { symbol: "BTCUSD_PERP", pair: "BTCUSD", openInterestUsd: 500_000 })];
  const result = await fetchTopBinance({ source, onReading: r => published.push(r), request: async url => {
    urls.push(url);
    return [{ timestamp: now - 300_000, longShortRatio: "1.5" }, { timestamp: now, longShortRatio: "2" }];
  } });
  assert.deepEqual(urls.sort(), [
    `https://dapi.binance.com/futures/data/topLongShortAccountRatio?pair=BTCUSD&contractType=PERPETUAL&period=5m&limit=300`,
    `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=300`,
  ]);
  assert.equal(result.readings.length, 2);
  // Weights/prices come from the global reading; ratios are the top-trader ones.
  assert.equal(result.readings[0].openInterestUsd, 1_000_000);
  assert.equal(result.readings[0].points.at(-1).ratio, 2);
  assert.equal(published.length, 2);
});

test("OKX top trader uses the top-trader endpoint with 5m and hourly history", async () => {
  const urls = [];
  const result = await fetchTopOkx({ source: () => [base("okx", { symbol: "BTC-USDT-SWAP", longWindowPoints: [{ timestamp: 1, ratio: 9 }] })],
    request: async url => { urls.push(url); return { code: "0", data: [[String(now), "0.8"]] }; } });
  assert.ok(urls.every(url => url.includes("/long-short-account-ratio-contract-top-trader?instId=BTC-USDT-SWAP")));
  assert.deepEqual(urls.map(url => new URL(url).searchParams.get("period")).sort(), ["1H", "5m"]);
  assert.equal(result.readings[0].points[0].ratio, 0.8);
  // The global all-account hourly history must never leak into the top-trader reading.
  assert.equal(result.readings[0].longWindowPoints[0].ratio, 0.8);
});

test("Gate top trader needs no request and uses top_lsr_account already fetched", async () => {
  const result = await fetchTopGate({ source: () => [
    base("gate", { symbol: "BTC_USDT", topPoints: [{ timestamp: now, ratio: 1.7 }] }),
    base("gate", { symbol: "ETH_USDT", asset: "ETH" }),
  ] });
  assert.equal(result.readings.length, 1);
  assert.equal(result.readings[0].points[0].ratio, 1.7);
  assert.equal(result.readings[0].topPoints, undefined);
  assert.equal(result.errorCount, 1);
});

test("before the global scan lists contracts, top trader waits instead of reporting an error", async () => {
  for (const fetcher of [fetchTopBinance, fetchTopOkx, fetchTopGate]) {
    const result = await fetcher({ source: () => [], request: async () => { throw new Error("must not request"); } });
    assert.equal(result.waiting, true);
  }
  let calls = 0;
  const collector = createLsarCollector({ fetchers: { binance: async () => { calls++; return { waiting: true, readings: [] }; } } });
  collector.getSnapshot();
  await new Promise(resolve => setImmediate(resolve));
  const snapshot = collector.getSnapshot();
  assert.equal(snapshot.sources[0].status, "connecting");
  assert.equal(snapshot.sources[0].error, null);
  assert.equal(calls, 1);
});

test("top-trader readings aggregate exactly like global LSAR (OI-weighted shares)", () => {
  const rows = createRows([
    base("binance", { points: [{ timestamp: Date.now() - 60_000, ratio: 3 }], openInterestUsd: 1 }),
    base("okx", { symbol: "BTC-USDT-SWAP", points: [{ timestamp: Date.now() - 60_000, ratio: 1 }], openInterestUsd: 3 }),
  ]);
  assert.equal(rows[0].longSharePct, ((0.75 * 1 + 0.5 * 3) / 4) * 100);
});

test("Binance futures-data budgets are per endpoint, so top-trader calls do not slow the global scan", async () => {
  let time = 0;
  const gate = new BinanceRequestGate({ now: () => time, sleep: async d => { time += d; }, spacingMs: 0, historyLimit: 2, historyWindowMs: 1000 });
  const global = "https://fapi.binance.com/futures/data/globalLongShortAccountRatio";
  const top = "https://fapi.binance.com/futures/data/topLongShortAccountRatio";
  await gate.enter(global); await gate.enter(global);
  await gate.enter(top); await gate.enter(top);
  assert.equal(time, 0, "each endpoint has its own window");
  await gate.enter(global);
  assert.ok(time >= 1000, "a third call on the same endpoint waits");
});
