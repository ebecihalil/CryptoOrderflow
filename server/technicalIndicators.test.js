import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateTechnicalIndicators, DEFAULT_TECHNICAL_SETTINGS, validateTechnicalSettings,
} from "../src/lib/technical-indicators.js";

const candles = values => values.map((close, index) => ({ time: 1_700_000_000 + index * 3600, close }));
const small = { emaPeriod: 2, smaPeriod: 2, bbPeriod: 2, bbStdDev: 2, rsiPeriod: 3, macdFast: 2, macdSlow: 3, macdSignal: 2 };
const near = (actual, expected) => assert.ok(
  Math.abs(actual - expected) <= Math.max(1e-9, Number.EPSILON * Math.abs(expected) * 2),
  `${actual} != ${expected}`,
);

test("SMA and EMA use actual close prices and SMA-seeded EMA warmup", () => {
  const result = calculateTechnicalIndicators(candles([2, 4, 8, 16]), small);
  assert.deepEqual(result.sma.map(point => point.value), [3, 6, 12]);
  const expected = [3, 19 / 3, 115 / 9];
  result.ema.forEach((point, index) => near(point.value, expected[index]));
  assert.equal(result.ema[0].time, candles([2, 4])[1].time);
});

test("Wilder RSI uses gains/losses rather than candle colour or volume", () => {
  const result = calculateTechnicalIndicators(candles([1, 2, 3, 2, 4, 3]), small).rsi;
  near(result[0].value, 200 / 3);
  near(result[1].value, 250 / 3);
  near(result[2].value, 2000 / 33);
  assert.equal(result[0].time, candles([1, 2, 3, 2])[3].time);
});

test("RSI handles upward, downward and flat runs without NaN", () => {
  assert.ok(calculateTechnicalIndicators(candles([1, 2, 3, 4, 5, 6]), small).rsi.every(p => p.value === 100));
  assert.ok(calculateTechnicalIndicators(candles([6, 5, 4, 3, 2, 1]), small).rsi.every(p => p.value === 0));
  assert.ok(calculateTechnicalIndicators(candles([4, 4, 4, 4, 4, 4]), small).rsi.every(p => p.value === 50));
});

test("Bollinger bands use population deviation, not sample deviation", () => {
  const bb = calculateTechnicalIndicators(candles([2, 4, 8, 16]), small).bb;
  assert.deepEqual(bb.middle.map(p => p.value), [3, 6, 12]);
  assert.deepEqual(bb.upper.map(p => p.value), [5, 10, 20]);
  assert.deepEqual(bb.lower.map(p => p.value), [1, 2, 4]);
});

test("Bollinger bands remain stable with high prices and small variation", () => {
  const bb = calculateTechnicalIndicators(candles([100_000_000.01, 100_000_000.03]), small).bb;
  near(bb.middle[0].value, 100_000_000.02);
  assert.ok(Math.abs((bb.upper[0].value - bb.middle[0].value) - 0.02) < 1e-7);
});

test("MACD, signal and histogram align after their separate warmup periods", () => {
  const result = calculateTechnicalIndicators(candles([1, 2, 3, 2, 4, 3]), small).macd;
  [1 / 2, 1 / 6, 7 / 18, 7 / 54].forEach((v, i) => near(result.macd[i].value, v));
  [1 / 3, 10 / 27, 17 / 81].forEach((v, i) => near(result.signal[i].value, v));
  [-1 / 6, 1 / 54, -13 / 162].forEach((v, i) => near(result.histogram[i].value, v));
  assert.equal(result.signal[0].time, result.macd[1].time);
});

test("empty or insufficient history produces no fabricated warmup values", () => {
  const empty = calculateTechnicalIndicators([]);
  assert.deepEqual(empty.ema, []);
  assert.deepEqual(empty.macd.histogram, []);
  assert.deepEqual(empty.rsi, []);
  const short = calculateTechnicalIndicators(candles([1, 2, 3]));
  assert.deepEqual(short.sma, []);
  assert.deepEqual(short.rsi, []);
  assert.deepEqual(short.bb.upper, []);
  assert.deepEqual(short.macd.signal, []);
});

test("calculations are prefix-stable with no lookahead and never mutate candles/settings", () => {
  const input = candles(Array.from({ length: 100 }, (_, i) => 50 + Math.sin(i / 3) * 4 + i / 20));
  const original = JSON.stringify(input);
  const full = calculateTechnicalIndicators(input);
  const first = calculateTechnicalIndicators(input.slice(0, 60));
  for (const key of ["ema", "sma", "rsi"]) assert.deepEqual(full[key].slice(0, first[key].length), first[key]);
  for (const key of ["upper", "middle", "lower"]) assert.deepEqual(full.bb[key].slice(0, first.bb[key].length), first.bb[key]);
  for (const key of ["macd", "signal", "histogram"]) assert.deepEqual(full.macd[key].slice(0, first.macd[key].length), first.macd[key]);
  assert.equal(JSON.stringify(input), original);
  assert.equal(DEFAULT_TECHNICAL_SETTINGS.emaPeriod, 20);
});

test("malformed, reversed or duplicate candle history fails explicitly", () => {
  assert.throws(() => calculateTechnicalIndicators(null), /array/);
  assert.throws(() => calculateTechnicalIndicators([{ time: 1, close: NaN }]), /finite/);
  assert.throws(() => calculateTechnicalIndicators([{ time: 1, close: -1 }]), /non-negative/);
  assert.throws(() => calculateTechnicalIndicators([{ time: 1.1, close: 1 }]), /integer/);
  assert.throws(() => calculateTechnicalIndicators([{ time: 1, close: 1 }, { time: 1, close: 2 }]), /unique/);
  assert.throws(() => calculateTechnicalIndicators([{ time: 2, close: 1 }, { time: 1, close: 2 }]), /ascending/);
});

test("technical parameters are bounded, finite and require fast MACD < slow", () => {
  assert.deepEqual(validateTechnicalSettings(), DEFAULT_TECHNICAL_SETTINGS);
  for (const input of [null, [], "20"]) assert.throws(() => validateTechnicalSettings(input), /object/);
  for (const value of [0, 1, 1.5, 501, Infinity, NaN, "20"]) assert.throws(() => validateTechnicalSettings({ emaPeriod: value }));
  for (const value of [0, -1, 11, Infinity, "2"]) assert.throws(() => validateTechnicalSettings({ bbStdDev: value }));
  assert.throws(() => validateTechnicalSettings({ macdFast: 30, macdSlow: 26 }), /smaller/);
  assert.throws(() => validateTechnicalSettings({ macdFast: 26 }), /smaller/);
  assert.throws(() => validateTechnicalSettings({ typo: 14 }), /Unknown/);
});
