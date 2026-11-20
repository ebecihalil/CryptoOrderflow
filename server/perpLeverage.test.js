import test from "node:test";
import assert from "node:assert/strict";
import { buildPerpLeverage, flowsByCandle, liquidatedShare, effectiveLeverage, PERP_LEVERAGE_DEFAULTS } from "./perpLeverage.js";

const H = 3600, N = 60;
// Flat candles at 100 unless a bar overrides its range.
const candles = (n, range = () => null) => Array.from({ length: n }, (_, i) => {
  const r = range(i) ?? { low: 99.9, high: 100.1, close: 100 };
  return { time: i * H, open: 100, ...r };
});
const minutes = (n, perExchange) => Array.from({ length: n }, (_, i) => ({ time: i * H, byExchange: perExchange(i) }));
const oiSeries = (exchange, n, coins) => ({ exchange, points: Array.from({ length: n + 1 }, (_, i) => ({ timestamp: i * H * 1000, oiCoin: coins(i) })) });
const always = { binance: [[0, N * H * 1000 + 1]], bybit: [[0, N * H * 1000 + 1]] };
const base = (over = {}) => ({ timeframe: "1h", candles: candles(N),
  spotMinutes: minutes(N, () => ({ binance: [500, 500] })), perpMinutes: minutes(N, () => ({ binance: [1000, 1000] })),
  oiContracts: [oiSeries("binance", N, i => 1000 + i * 10)], coverage: always, ...over });
const prior = effectiveLeverage(PERP_LEVERAGE_DEFAULTS.priorMedian, PERP_LEVERAGE_DEFAULTS.sigma, PERP_LEVERAGE_DEFAULTS.maxLeverage);

test("liquidation physics: a position at L× is gone after a move of about 1/L", () => {
  const { sigma, maintenance } = PERP_LEVERAGE_DEFAULTS;
  assert.equal(liquidatedShare(0, 10, sigma, maintenance), 0);
  // Half the positions (the median, 10×) die once price moves 1/10 − 0.5% against them.
  assert.ok(Math.abs(liquidatedShare(0.1 - maintenance, 10, sigma, maintenance) - 0.5) < 0.01);
  assert.ok(liquidatedShare(0.9, 10, sigma, maintenance) > 0.99);
  assert.ok(effectiveLeverage(10, 0.75) < 10, "notional/margin is below the median leverage");
});

test("calm market, neutral inputs: realistic leverage in × with long = short = average", () => {
  const last = buildPerpLeverage(base()).at(-1);
  assert.ok(Math.abs(last.avg - prior) < 1, JSON.stringify(last));
  assert.equal(last.long, last.short);
  assert.ok(last.avg > 2 && last.avg < 40);
});

test("a small dip that wipes out many longs means longs were highly leveraged", () => {
  // OI built at 100, then a 2% dip with long liquidations worth 20% of OI.
  const dip = 50;
  const rows = buildPerpLeverage(base({
    candles: candles(N, i => i === dip ? { low: 98, high: 100, close: 99 } : null),
    liquidations: [{ exchange: "binance", side: "long", time: dip * H * 1000 + 60_000, usd: 0.2 * 1490 * 98 }],
  }));
  const last = rows.at(-1);
  assert.ok(last.long > prior * 1.5, JSON.stringify(last));
  assert.ok(last.long > last.short);
  assert.ok(last.long <= 125);
});

test("a large drop with no long liquidations means longs use low leverage", () => {
  const drop = 50;
  const rows = buildPerpLeverage(base({ candles: candles(N, i => i >= drop ? { low: 88, high: 100, close: 89 } : null) }));
  const last = rows.at(-1);
  assert.ok(last.long < prior * 0.8, JSON.stringify(last));
});

test("positive funding (longs paying) tilts the long side above the short side", () => {
  const funding = Array.from({ length: N }, (_, i) => ({ time: i * H, meanPct: 0.05 }));
  const last = buildPerpLeverage(base({ funding })).at(-1);
  assert.ok(last.long > last.short, JSON.stringify(last));
});

test("strict: an exchange without a connected liquidation feed is left out", () => {
  const rows = buildPerpLeverage(base({ coverage: {} }));
  assert.ok(rows.every(row => row.avg === null && row.exchanges.length === 0));
  const partial = buildPerpLeverage(base({
    perpMinutes: minutes(N, () => ({ binance: [1000, 1000], bybit: [1000, 1000] })),
    oiContracts: [oiSeries("binance", N, () => 1000), oiSeries("bybit", N, () => 500)],
    coverage: { binance: always.binance },
  }));
  assert.deepEqual(partial.at(-1).exchanges, ["binance"]);
});

test("per-exchange minute flows sum into candles", () => {
  const map = flowsByCandle([{ time: 0, byExchange: { a: [1, 2] } }, { time: 60, byExchange: { a: [3, 4] } }], "1h");
  assert.deepEqual(map.get(0).get("a"), [4, 6]);
});
