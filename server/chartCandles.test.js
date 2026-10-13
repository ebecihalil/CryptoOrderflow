import test from "node:test";
import assert from "node:assert/strict";
import { createCandleService, parseCandles, validateCandleQuery } from "./chartCandles.js";
import { BinanceRequestGate } from "./binanceRequestGate.js";

const query = { exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" };
const rows = [
  [1700000000000, "100", "102", "99", "101", "1000"],
  [1700003600000, "101", "103", "100", "102", "1200"],
];
const meta = { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL" };

test("candle inputs reject arbitrary hosts, injection, unsupported timeframes and arrays", () => {
  assert.deepEqual(validateCandleQuery({}), query);
  for (const invalid of [
    { exchange: "https://evil.com" }, { symbol: "../BTCUSDT" }, { symbol: "BTCUSD" },
    { symbol: ["BTCUSDT"] }, { timeframe: "1s" }, { timeframe: ["1h"] }, { exchange: ["bybit"] },
  ]) assert.throws(() => validateCandleQuery(invalid), error => error.status === 400);
});

test("candles normalize Bybit reverse order, validate OHLC, gaps and forming status", () => {
  const data = parseCandles("bybit", { result: { list: [...rows].reverse() } }, "1h", 1700004000000);
  assert.equal(data[0].volume, 1000);
  assert.equal(data[0].closed, true);
  assert.equal(data[1].closed, false);
  assert.deepEqual(data, parseCandles("binance", rows, "1h", 1700004000000));
  assert.throws(() => parseCandles("binance", [rows[0], rows[0]], "1h"));
  assert.throws(() => parseCandles("binance", [[...rows[0].slice(0, 5), null]], "1h"));
  assert.throws(() => parseCandles("binance", [[1700000000000, 100, 98, 99, 101, 1]], "1h"));
});

test("concurrent requests coalesce, refresh is cached and candle settings don't affect cache", async () => {
  let time = 1700004000000, candleCalls = 0, metadataCalls = 0;
  const service = createCandleService({ now: () => time, gates: {}, request: async url => {
    await new Promise(resolve => setTimeout(resolve, 5));
    if (url.includes("exchangeInfo")) { metadataCalls++; return { symbols: [meta] }; }
    candleCalls++; return rows;
  } });
  const [first, second] = await Promise.all([service.get(query), service.get(query)]);
  assert.equal(first, second);
  await service.get({ ...query, backBars: 100 });
  assert.equal(candleCalls, 1);
  assert.equal(metadataCalls, 1);
  time += 30_001;
  await service.get(query);
  assert.equal(candleCalls, 2);
  assert.equal(metadataCalls, 1);
});

test("stale candles retain timestamp and signal a failed refresh without request storms", async () => {
  let time = 1700004000000, fail = false, calls = 0;
  const service = createCandleService({ now: () => time, gates: { binance: { blockedUntil: time + 300_000 } },
    request: async url => {
      calls++;
      if (fail) throw new Error("blocked IP 1.2.3.4");
      return url.includes("exchangeInfo") ? { symbols: [meta] } : rows;
    } });
  const first = await service.get(query);
  time += 30_001; fail = true;
  const stale = await service.get(query);
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.equal(stale.candles, first.candles);
  assert.ok(!stale.error.includes("1.2.3.4"));
  const afterFailure = calls;
  await service.get(query);
  assert.equal(calls, afterFailure);
  assert.ok(stale.retryAt > time);
});

test("non-crypto or non-perpetual contracts cannot initiate candle requests", async () => {
  for (const symbol of [
    { ...meta, baseAsset: "TSLA" }, { ...meta, contractType: "CURRENT_QUARTER" },
  ]) {
    let candleCalls = 0;
    const service = createCandleService({ gates: {}, request: async url => {
      if (url.includes("exchangeInfo")) return { symbols: [symbol] };
      candleCalls++; return rows;
    } });
    await assert.rejects(service.get(query), error => error.status === 400);
    assert.equal(candleCalls, 0);
  }
});

test("Bybit validates linear perpetual metadata and uses base-volume kline data", async () => {
  const urls = [];
  const service = createCandleService({ gates: {}, request: async url => {
    urls.push(url);
    return url.includes("instruments-info") ? { result: { list: [{
      symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT", status: "Trading", contractType: "LinearPerpetual",
    }] } } : { result: { list: [...rows].reverse() } };
  } });
  const snapshot = await service.get({ ...query, exchange: "bybit" });
  assert.equal(snapshot.candles.length, 2);
  assert.ok(urls.every(url => url.includes("category=linear")));
  assert.match(urls[1], /limit=1000/);
});

test("Binance klines consume documented variable weights through the shared gate", async () => {
  let now = 1800000000000;
  const gate = new BinanceRequestGate({ now: () => now, sleep: async ms => { now += ms; } });
  for (const limit of [99, 100, 499, 500, 1000, 1500]) {
    await gate.enter(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&limit=${limit}`);
  }
  assert.deepEqual(gate.generalCosts, [1, 2, 2, 5, 5, 10]);
});
