import test from "node:test";
import assert from "node:assert/strict";
import { aggregateCandleVolumes, parseOkxVolumeRows, parseGateVolumeRows } from "./candleVolumeMath.js";
import { calculateLiquidityZones } from "../src/lib/liquidity-zones.ts";

const bars = (volume, count = 80) => Array.from({ length: count }, (_, i) => ({
  time: 1_750_000_000 + i * 3600, open: 2, high: 3, low: 1, close: 2, volume, closed: i < count - 1,
}));
const source = (exchange, volume, divisor = 1) => ({ exchange, candles: bars(volume), divisor, stale: false });

test("volume is summed in underlying-coin units without changing selected price candles", () => {
  const price = { candles: bars(10) };
  const result = aggregateCandleVolumes(price, [source("binance", 10, 1000), source("bybit", 20),
    source("okx", 30), source("gate", 40)], "1h");
  assert.equal(result.candles.length, 80);
  assert.equal(result.candles[0].volume, 10090);
  assert.equal(result.candles[0].close, 2);
  assert.equal(price.candles[0].volume, 10);
  assert.equal(result.candles.at(-1).closed, false);
});

test("one fixed contributing venue set covers the whole aligned series; no missing volume zero-fill", () => {
  const a = source("binance", 10), b = source("bybit", 20);
  b.candles.shift();
  b.candles.pop();
  const result = aggregateCandleVolumes({ candles: bars(10) }, [a, b], "1h");
  assert.equal(result.candles.length, 78);
  assert.ok(result.candles.every(bar => bar.volume === 30));
  assert.equal(result.candles.at(-1).time, bars(10).at(-2).time);
});

test("failed, stale, short and lagging venues are excluded, never silently represented as zero", () => {
  const good = source("binance", 10), stale = { ...source("okx", 30), stale: true };
  const short = { ...source("gate", 40), candles: bars(40, 49) };
  const lagging = source("bybit", 20); lagging.candles.splice(-3);
  const result = aggregateCandleVolumes({ candles: bars(10) }, [good, stale, short, lagging, { exchange: "bybit" }], "1h");
  assert.deepEqual(result.exchanges, ["binance"]);
  assert.equal(result.candles[0].volume, 10);
  assert.throws(() => aggregateCandleVolumes({ candles: bars(10) }, [stale], "1h"), /fresh volume/);
});

test("a gap does not compress the timeline into fictitious neighboring candles", () => {
  const gap = source("gate", 40);
  gap.candles.splice(65, 1);
  assert.throws(() => aggregateCandleVolumes({ candles: bars(10) }, [gap], "1h"), /overlapping/);
});

test("OKX base-currency volume and confirmation flag are explicit, not contract or quote volume", () => {
  const parsed = parseOkxVolumeRows([["1750000000000", "2", "3", "1", "2", "999", "7", "888", "0"]]);
  assert.equal(parsed[0].row[5], "7");
  assert.equal(parsed[0].confirmed, false);
  assert.throws(() => parseOkxVolumeRows([["1750000000000", "2", "3", "1", "2", "99"]]), /Malformed/);
});

test("Gate.io contracts convert through quanto_multiplier; quote turnover is not base volume", () => {
  const parsed = parseGateVolumeRows([{ t: 1750000000, o: "2", h: "3", l: "1", c: "2", v: 1000, sum: "9999" }], 0.001);
  assert.equal(parsed[0][5], 1);
  assert.equal(parsed[0][0], 1750000000000);
  assert.throws(() => parseGateVolumeRows([{ t: 1750000000, sum: "9999" }], 0.001), /contract volume/);
  assert.throws(() => parseGateVolumeRows([], 0), /metadata/);
});

test("the summed volume changes pivot qualification, not just the displayed histogram", () => {
  const price = { candles: Array.from({ length: 101 }, (_, i) => ({
    time: 1750000800 + i * 3600, open: 100, high: 101, low: 99, close: 100, volume: 1, closed: true,
  })) };
  for (const index of [40, 80]) Object.assign(price.candles[index], { open: 109, close: 109, high: 110, low: 109 });
  const extraVolume = price.candles.map((bar, index) => ({ ...bar, volume: [40, 80].includes(index) ? 100 : 1 }));
  const summed = aggregateCandleVolumes(price, [
    { exchange: "binance", candles: price.candles, divisor: 1 },
    { exchange: "bybit", candles: extraVolume, divisor: 1 },
  ], "1h");
  const settings = { backBars: 300, volMult: 1.2 };
  assert.equal(calculateLiquidityZones(price.candles, settings).zones.length, 0);
  assert.equal(calculateLiquidityZones(summed.candles, settings).zones.length, 1);
});
