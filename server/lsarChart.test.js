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
  const deps = { globalReadings: a => (calls.push(["global", a]), []), topReadings: a => (calls.push(["top", a]), []) };
  assert.equal(getLsarChart({ asset: "BTC", kind: "top", timeframe: "1h" }, deps).kind, "top");
  getLsarChart({ asset: "eth" }, deps);
  assert.deepEqual(calls, [["top", "BTC"], ["global", "ETH"]]);
  for (const bad of [{ asset: "BTC", timeframe: "1m" }, { asset: "BTC", kind: "x" }, { asset: "" }])
    assert.throws(() => getLsarChart(bad, deps), e => e.status === 400);
});
