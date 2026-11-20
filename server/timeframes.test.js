import test from "node:test";
import assert from "node:assert/strict";
import { bucketStart, nextBucket, aggregateCandles, isContiguous, timeframeSeconds, CHART_TIMEFRAMES } from "./timeframes.js";

const utc = (...args) => Date.UTC(...args) / 1000;

test("calendar buckets: Monday weeks, calendar months and quarters (UTC)", () => {
  // 2026-11-20 is a Friday -> week starts Monday 2026-11-16.
  assert.equal(bucketStart("1w", utc(2026, 10, 20, 15)), utc(2026, 10, 16));
  assert.equal(nextBucket("1w", utc(2026, 10, 16)), utc(2026, 10, 23));
  assert.equal(bucketStart("1mo", utc(2026, 1, 28, 23, 59)), utc(2026, 1, 1));
  assert.equal(nextBucket("1mo", utc(2026, 11, 1)), utc(2027, 0, 1), "December rolls into January");
  assert.equal(bucketStart("3mo", utc(2026, 7, 15)), utc(2026, 6, 1), "Aug is in the Jul–Sep quarter");
  assert.equal(nextBucket("3mo", utc(2026, 9, 1)), utc(2027, 0, 1));
  assert.equal(bucketStart("3m", 1000), 900);
  assert.ok(CHART_TIMEFRAMES.every(tf => timeframeSeconds(tf) > 0));
});

test("aggregation keeps OHLCV correct and drops an incomplete first bucket", () => {
  const minute = (i, o, h, l, c, v) => ({ time: 60 * i, open: o, high: h, low: l, close: c, volume: v, closed: true });
  // Minutes 1..6: minute 1-2 belong to an incomplete first 3m bucket (0..2).
  const bars = [minute(1, 9, 9, 9, 9, 1), minute(2, 9, 9, 9, 9, 1),
    minute(3, 10, 12, 9, 11, 5), minute(4, 11, 15, 10, 13, 7), minute(5, 13, 14, 8, 9, 3)];
  const out = aggregateCandles(bars, "3m", 10_000_000);
  assert.deepEqual(out, [{ time: 180, open: 10, high: 15, low: 8, close: 9, volume: 15, closed: true }]);
  // A bucket whose period has not ended is not closed.
  assert.equal(aggregateCandles(bars, "3m", 300 * 1000)[0].closed, false);
});

test("monthly candles roll up into quarters, and contiguity follows the calendar", () => {
  const months = [0, 1, 2, 3, 4, 5].map(m => ({ time: utc(2026, m, 1), open: m + 1, high: m + 2, low: m, close: m + 1.5, volume: 10, closed: true }));
  assert.ok(isContiguous(months, "1mo"));
  const q = aggregateCandles(months, "3mo", Date.UTC(2027, 0, 1));
  assert.deepEqual(q.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume]), [
    [utc(2026, 0, 1), 1, 4, 0, 3.5, 30], [utc(2026, 3, 1), 4, 7, 3, 6.5, 30]]);
  assert.ok(!isContiguous([months[0], months[2]], "1mo"));
});

import { createCandleService, derivedFrom, validateCandleQuery } from "./chartCandles.js";

test("all Super Charts timeframes validate; non-native ones are built from smaller candles", () => {
  for (const tf of ["1m", "3m", "1w", "1mo", "3mo"]) assert.equal(validateCandleQuery({ timeframe: tf }).timeframe, tf);
  assert.equal(derivedFrom("binance", "1w"), null, "Binance weekly is native");
  assert.equal(derivedFrom("binance", "3mo"), "1mo");
  assert.equal(derivedFrom("okx", "3mo"), null, "OKX has native 3M");
  assert.equal(derivedFrom("gate", "3m"), "1m");
  assert.equal(derivedFrom("gate", "1mo"), "24h");
});

test("Binance 3M candles are built from native monthly candles with calendar validation", async () => {
  const months = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(m => [Date.UTC(2025, m, 1), "100", "120", "90", String(100 + m), "10"]);
  const urls = [];
  const service = createCandleService({ now: () => Date.UTC(2025, 9, 15), gates: {}, request: async url => {
    urls.push(url);
    if (url.includes("exchangeInfo")) return { symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL" }] };
    return months;
  } });
  const data = await service.get({ exchange: "binance", symbol: "BTCUSDT", timeframe: "3mo" });
  assert.ok(urls.some(url => url.includes("interval=1M")), "fetched native 1M");
  assert.deepEqual(data.candles.map(c => [c.time, c.open, c.close, c.volume, c.closed]), [
    [Date.UTC(2025, 0, 1) / 1000, 100, 102, 30, true],
    [Date.UTC(2025, 3, 1) / 1000, 100, 105, 30, true],
    [Date.UTC(2025, 6, 1) / 1000, 100, 108, 30, true],
  ]);
  assert.equal(data.derivedFrom, "1mo");
});

import { buildCvdCandles } from "./cvdMath.js";

test("CVD buckets follow the same timeframes as price (3m and Monday weeks)", () => {
  const minute = (time, delta) => ({ time, delta, high: Math.max(0, delta), low: Math.min(0, delta), buyValue: Math.max(0, delta), sellValue: Math.max(0, -delta), trades: 1, sources: ["binance"] });
  const mon = utc(2026, 10, 16), now = mon + 10 * 86400;
  const minutes = [minute(mon + 60, 5), minute(mon + 120, 5), minute(mon + 180, -2), minute(mon + 8 * 86400, 1)];
  const threeMin = buildCvdCandles(minutes, "3m", "1y", now);
  assert.deepEqual(threeMin.map(c => c.time).slice(0, 2), [mon, mon + 180]);
  const weekly = buildCvdCandles(minutes, "1w", "1y", now);
  assert.deepEqual(weekly.map(c => c.time), [mon, mon + 7 * 86400]);
  assert.equal(weekly[0].close, 8);
});
