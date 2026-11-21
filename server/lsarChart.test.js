import test from "node:test";
import assert from "node:assert/strict";
import { buildLsarSeries, getLsarChart } from "./lsarChart.js";

const pts = (ratios, step = 300_000, start = 1_700_000_100_000) => ratios.map((ratio, i) => ({ timestamp: start + i * step, ratio }));

test("OI-weighted aggregate ratio per candle (long shares, not raw ratios, are averaged)", () => {
  const { points, sources } = buildLsarSeries([
    { exchange: "binance", symbol: "BTCUSDT", openInterestUsd: 300, points: pts([3, 3]) }, // 75% long
    { exchange: "okx", symbol: "BTC-USDT-SWAP", openInterestUsd: 100, points: pts([1, 1]) }, // 50% long
  ], "5m");
  assert.equal(points.length, 2);
  assert.equal(points[0].longPct, 68.75); // (300*0.75 + 100*0.5) / 400
  assert.equal(points[0].ratio, 2.2);
  assert.equal(sources.length, 2);
});

test("a candle is skipped when exchanges holding most of the OI are missing", () => {
  const { points } = buildLsarSeries([
    { exchange: "binance", openInterestUsd: 900, points: pts([2]) },
    { exchange: "okx", openInterestUsd: 100, points: pts([1, 1]) },
  ], "5m");
  assert.equal(points.length, 1, "second candle has only 10% of OI");
});

test("larger timeframes use the hourly history and the last reading in each candle", () => {
  const hourly = pts([1, 2, 3, 4], 3_600_000, Date.UTC(2026, 0, 1));
  const { points } = buildLsarSeries([{ exchange: "binance", openInterestUsd: 1, points: [], longWindowPoints: hourly }], "4h");
  assert.equal(points.length, 1);
  assert.equal(points[0].ratio, 4);
});

test("query validation and kind routing", () => {
  const calls = [];
  const deps = { directory: null, globalReadings: a => (calls.push(["global", a]), []), topReadings: a => (calls.push(["top", a]), []) };
  assert.equal(getLsarChart({ asset: "BTC", kind: "top", timeframe: "1h" }, deps).kind, "top");
  getLsarChart({ asset: "eth" }, deps);
  assert.deepEqual(calls, [["top", "BTC"], ["global", "ETH"]]);
  for (const bad of [{ asset: "BTC", timeframe: "1m" }, { asset: "BTC", kind: "x" }, { asset: "" }])
    assert.throws(() => getLsarChart(bad, deps), e => e.status === 400);
});

test("ratio history is kept beyond what exchanges publish (merged, aggregated, RECORD_DAYS)", async () => {
  const { mergeLsarHistory } = await import("./lsarChart.js");
  const { RECORD_DAYS } = await import("./retention.js");
  const store = { "5m": new Map(), "1h": new Map() };
  const day = 86400, now = 200 * day * 1000;
  // Exchanges return hourly points for an older window; later those are gone from the exchange.
  mergeLsarHistory(store, { "1h": [{ time: 180 * day, ratio: 1.5, longPct: 60 }, { time: 180 * day + 3600, ratio: 2, longPct: 66.67 }] }, "1h", now);
  const later = mergeLsarHistory(store, { "1h": [{ time: 199 * day, ratio: 1, longPct: 50 }] }, "24h", now);
  assert.deepEqual(later.map(p => p.time), [180 * day, 199 * day]);
  assert.equal(later[0].ratio, 2, "last reading in the day");
  // Older than RECORD_DAYS is dropped.
  mergeLsarHistory(store, {}, "1h", (180 + RECORD_DAYS + 1) * day * 1000);
  assert.equal(store["1h"].size, 1);
});
