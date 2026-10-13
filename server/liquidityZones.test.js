import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateLiquidityZones, confirmedPivot, wilderAtr } from "../src/lib/liquidity-zones.ts";

const options = { backBars: 300, volMult: 1.2 };
function bars(count = 101) {
  return Array.from({ length: count }, (_, i) => ({
    time: 1700000000 + i * 3600, open: 100, high: 101, low: 99,
    close: 100, volume: 1, closed: true,
  }));
}
function fixture() {
  const candles = bars();
  for (const index of [40, 80]) Object.assign(candles[index], {
    open: 109, close: 109, low: 109, high: 110, volume: 100,
  });
  return candles;
}

test("ATR uses first true range and SMA-seeded Wilder smoothing, not simple ATR", () => {
  const candles = bars(16);
  candles[14].high = 115; candles[14].low = 95;
  const atr = wilderAtr(candles);
  assert.equal(atr[12], null);
  assert.equal(atr[13], 2);
  assert.equal(atr[14], (2 * 13 + 20) / 14);
  assert.equal(atr[15], (atr[14] * 13 + 2) / 14);
});

test("a pivot is unavailable until 10 later candles and latest equal extreme wins", () => {
  const candles = fixture();
  assert.equal(confirmedPivot(candles, 49, true), null);
  assert.equal(confirmedPivot(candles, 50, true), 110);
  candles[45].high = 110;
  assert.equal(confirmedPivot(candles, 50, true), null);
  assert.equal(confirmedPivot(candles, 55, true), 110);
});

test("only volume-qualified pivots count; two pivots form an extended zone", () => {
  const candles = fixture();
  assert.equal(calculateLiquidityZones(candles.slice(0, 90), options).zones.length, 0);
  const result = calculateLiquidityZones(candles, options);
  assert.equal(result.zones.length, 1);
  assert.equal(result.zones[0].count, 2);
  assert.equal(result.zones[0].leftTime, candles[40].time);
  assert.equal(result.zones[0].createdTime, candles[90].time);
  assert.equal(result.zones[0].status, "resistance");
  assert.equal(result.zones[0].top, 110);
  candles[80].volume = 1;
  assert.equal(calculateLiquidityZones(candles, options).zones.length, 0);
});

test("zone state remembers entry side while inside and detects opposite-side breaks", () => {
  const candles = fixture();
  Object.assign(candles[91], { open: 110, close: 110, high: 110, low: 110 });
  Object.assign(candles[92], { open: 111, close: 111, high: 112, low: 110.5 });
  Object.assign(candles[93], { open: 111, close: 111, high: 120, low: 100 });
  Object.assign(candles[94], { open: 112, close: 112, high: 113, low: 110 });
  Object.assign(candles[95], { open: 110, close: 110, high: 110, low: 110 });
  const atInside = calculateLiquidityZones(candles.slice(0, 96), options);
  assert.equal(atInside.zones[0].status, "inside");
  assert.equal(atInside.zones[0].side, 1);
  const result = calculateLiquidityZones(candles, options);
  assert.deepEqual(result.signals.filter(signal => signal.type === "breakout").map(signal => signal.time),
    [candles[92].time, candles[96].time]);
  assert.equal(result.zones[0].side, -1);
  // The source does not count a wick that spans both bounds without an endpoint inside.
  assert.ok(!result.signals.some(signal => signal.time === candles[93].time && signal.type === "touch"));
  assert.ok(result.signals.some(signal => signal.time === candles[94].time && signal.type === "touch"));
});

test("forming candle signals are provisional and recomputation rolls them back", () => {
  const candles = fixture().slice(0, 93);
  Object.assign(candles[92], { open: 111, close: 111, low: 110.5, high: 112, closed: false });
  const result = calculateLiquidityZones(candles, options);
  assert.equal(result.signals.find(signal => signal.type === "breakout").closed, false);
  candles[92].close = 100; candles[92].low = 99;
  assert.ok(!calculateLiquidityZones(candles, options).signals.some(signal => signal.type === "breakout"));
});

test("scan window uses the source's inclusive confirmation-bar cutoff", () => {
  assert.equal(calculateLiquidityZones(fixture(), { ...options, backBars: 50 }).zones.length, 1);
  const longer = [...fixture(), ...bars(400).map((bar, i) => ({ ...bar, time: 1700000000 + (101 + i) * 3600 }))];
  assert.equal(calculateLiquidityZones(longer, options).zones.length, 0);
});

test("input candles are not mutated and invalid settings fail explicitly", () => {
  const candles = fixture(), original = structuredClone(candles);
  assert.deepEqual(calculateLiquidityZones(candles, options), calculateLiquidityZones(candles, options));
  assert.deepEqual(candles, original);
  assert.throws(() => calculateLiquidityZones(candles, { backBars: 49, volMult: 1.2 }));
  assert.throws(() => calculateLiquidityZones(candles, { backBars: 300, volMult: NaN }));
});

test("the orderflow UI exposes source settings, provisional signals and the MPL source", () => {
  const ui = readFileSync(new URL("../src/components/orderflow-indicators.tsx", import.meta.url), "utf8");
  assert.match(ui, /backBars: 300, volMult: 1\.2/);
  assert.match(ui, /min="50" max="900" step="1"/);
  assert.match(ui, /type="number" min="0\.1"/);
  assert.match(ui, /transparency: 35/);
  assert.match(ui, /Provisional/);
  assert.match(ui, /api\/indicators\/liquidity-zones\/source/);
  assert.match(ui, /MPL 2\.0/);
  assert.match(ui, /feedWarning/);
});
