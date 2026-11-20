import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTRA_INDICATORS, computeExtraIndicator, extraParams, smaArr, emaArr, rmaArr, wmaArr, trueRangeArr,
  keltner, donchian, ichimoku, psar, supertrend, stochastic, williamsR, cci, adx, mfi, obv, roc, cmf, vwap,
} from "../src/lib/extra-indicators.js";

const H = 3600;
const bars = rows => rows.map(([open, high, low, close, volume = 100], i) => ({ time: 1_700_000_000 + i * H, open, high, low, close, volume }));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
// A deterministic wavy series for structural checks.
const wave = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 9) + i * 0.05;
  return [c - 0.3, c + 1 + (i % 5) * 0.2, c - 1 - (i % 3) * 0.2, c, 50 + (i % 7) * 10];
});

test("moving-average building blocks match hand calculations", () => {
  assert.deepEqual(smaArr([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  assert.deepEqual(emaArr([2, 4, 8], 2), [null, 3, 19 / 3]); // SMA seed, then alpha 2/3
  assert.deepEqual(wmaArr([1, 2, 3], 3), [null, null, (1 * 1 + 2 * 2 + 3 * 3) / 6]);
  near(rmaArr([2, 4, 8], 2)[2], 3 + 0.5 * (8 - 3)); // Wilder alpha = 1/length
  assert.deepEqual(trueRangeArr(bars([[1, 2, 1, 2], [2, 5, 3, 4]])), [1, 3]); // max(5-3, |5-2|, |3-2|)
});

test("Donchian and Keltner channels bracket the basis correctly", () => {
  const c = bars(wave);
  const d = donchian(c, { length: 20 });
  for (let i = 19; i < c.length; i++) {
    assert.equal(d.upper[i], Math.max(...c.slice(i - 19, i + 1).map(x => x.high)));
    assert.equal(d.lower[i], Math.min(...c.slice(i - 19, i + 1).map(x => x.low)));
  }
  const k = keltner(c, { length: 20, multiplier: 2, atrLength: 10 });
  const i = 250;
  near(k.upper[i] - k.mid[i], k.mid[i] - k.lower[i]);
  assert.ok(k.upper[i] > k.mid[i]);
});

test("Ichimoku spans are projected ahead and Chikou plotted behind", () => {
  const c = bars(wave);
  const ich = ichimoku(c, { conversion: 9, base: 26, spanB: 52, displacement: 26 });
  assert.equal(ich.senkouA.at(-1).time, c.at(-1).time + 25 * H, "cloud extends 25 bars into the future");
  // Tenkan = midpoint of last 9 highs/lows.
  const i = 100, w = c.slice(i - 8, i + 1);
  near(ich.tenkan[i], (Math.max(...w.map(x => x.high)) + Math.min(...w.map(x => x.low))) / 2);
  assert.equal(ich.chikou[0].value, c[25].close);
  assert.equal(ich.chikou.at(-1).value, null);
});

test("Parabolic SAR stays below price in an uptrend and flips above in a downtrend", () => {
  const up = bars(Array.from({ length: 30 }, (_, i) => [100 + i, 101 + i, 99 + i, 100.5 + i]));
  const s = psar(up, { start: 0.02, increment: 0.02, maximum: 0.2 });
  for (let i = 5; i < up.length; i++) assert.ok(s.sar[i] < up[i].low, `bar ${i}`);
  const down = bars([...Array.from({ length: 15 }, (_, i) => [100 + i, 101 + i, 99 + i, 100.5 + i]),
    ...Array.from({ length: 15 }, (_, i) => [114 - 2 * i, 115 - 2 * i, 112 - 2 * i, 113 - 2 * i])]);
  const d = psar(down, { start: 0.02, increment: 0.02, maximum: 0.2 });
  assert.equal(d.up.at(-1), false);
  assert.ok(d.sar.at(-1) > down.at(-1).high);
});

test("Supertrend marks uptrends below price and downtrends above price", () => {
  const up = bars(Array.from({ length: 60 }, (_, i) => [100 + i, 101 + i, 99 + i, 100.6 + i]));
  const st = supertrend(up, { atrLength: 10, factor: 3 });
  assert.equal(st.dir.at(-1), -1);
  assert.ok(st.line.at(-1) < up.at(-1).close);
  const down = bars(Array.from({ length: 60 }, (_, i) => [200 - i, 201 - i, 199 - i, 199.4 - i]));
  const sd = supertrend(down, { atrLength: 10, factor: 3 });
  assert.equal(sd.dir.at(-1), 1);
  assert.ok(sd.line.at(-1) > down.at(-1).close);
});

test("oscillators stay in range and hit their extremes at range edges", () => {
  const rising = bars(Array.from({ length: 40 }, (_, i) => [10 + i, 11 + i, 9 + i, 11 + i]));
  assert.equal(stochastic(rising, { kLength: 14, kSmoothing: 1, dSmoothing: 3 }).k.at(-1), 100, "close at the 14-bar high");
  assert.equal(williamsR(rising, { length: 14 }).at(-1), 0);
  const c = bars(wave);
  for (const v of stochastic(c, { kLength: 14, kSmoothing: 1, dSmoothing: 3 }).k.filter(x => x !== null)) assert.ok(v >= 0 && v <= 100);
  for (const v of williamsR(c, { length: 14 }).filter(x => x !== null)) assert.ok(v >= -100 && v <= 0);
  const a = adx(c, { length: 14 });
  for (const v of a.adx.filter(x => x !== null)) assert.ok(v >= 0 && v <= 100);
  for (const v of mfi(c, { length: 14 }).filter(x => x !== null)) assert.ok(v >= 0 && v <= 100);
  // CCI: typical price exactly at its mean -> 0.
  assert.equal(cci(bars(Array.from({ length: 25 }, () => [5, 6, 4, 5])), { length: 20 }).at(-1), 0);
});

test("volume indicators: OBV, CMF, VWAP and ROC", () => {
  const c = bars([[1, 2, 1, 2, 10], [2, 3, 2, 3, 5], [3, 3, 1, 1, 4], [1, 1, 1, 1, 7]]);
  assert.deepEqual(obv(c), [0, 5, 1, 1]);
  near(roc(c, { length: 1 })[1], 50);
  // CMF: close at high -> +1 money-flow multiplier.
  assert.equal(cmf(bars([[1, 2, 1, 2, 10], [1, 2, 1, 2, 10]]), { length: 2 }).at(-1), 1);
  // VWAP resets at the UTC day boundary.
  const dayStart = 1_700_006_400 - (1_700_006_400 % 86400) + 86400;
  const v = vwap([{ time: dayStart - 3600, high: 10, low: 10, close: 10, volume: 1 }, { time: dayStart, high: 20, low: 20, close: 20, volume: 1 }]);
  assert.deepEqual(v, [10, 20]);
});

test("every registered indicator computes on real-looking data without throwing", () => {
  const c = bars(wave);
  assert.ok(EXTRA_INDICATORS.length >= 18);
  for (const def of EXTRA_INDICATORS) {
    const result = computeExtraIndicator(def.id, c);
    assert.ok(result && result.series.length, def.id);
    for (const s of result.series) {
      assert.ok(s.data.some(p => p.value !== null), `${def.id}/${s.key} has values`);
      assert.ok(s.data.every(p => p.value === null || Number.isFinite(p.value)), `${def.id}/${s.key} finite`);
    }
  }
});

test("saved parameters are validated and fall back to TradingView defaults", () => {
  assert.deepEqual(extraParams("keltner", { length: 30, multiplier: 2.5, atrLength: -1 }), { length: 30, multiplier: 2.5, atrLength: 10 });
  assert.deepEqual(extraParams("stoch"), { kLength: 14, kSmoothing: 1, dSmoothing: 3 });
  assert.deepEqual(extraParams("ichimoku", { conversion: 9.5 }), { conversion: 9, base: 26, spanB: 52, displacement: 26 });
});
