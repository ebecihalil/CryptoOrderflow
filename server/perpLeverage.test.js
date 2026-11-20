import test from "node:test";
import assert from "node:assert/strict";
import { buildPerpLeverage, flowsByCandle } from "./perpLeverage.js";

const H = 3600;
const candles = n => Array.from({ length: n }, (_, i) => ({ time: i * H, close: 100 }));
// one recorded minute per candle per market with per-exchange [buy, sell]
const minutes = (n, perExchange) => Array.from({ length: n }, (_, i) => ({ time: i * H, byExchange: perExchange(i) }));
const oiSeries = (exchange, n, coins) => ({ exchange, points: Array.from({ length: n + 1 }, (_, i) => ({ timestamp: i * H * 1000, oiCoin: coins(i) })) });

test("balanced buying and selling: long = short = average", () => {
  const rows = buildPerpLeverage({ timeframe: "1h", candles: candles(30),
    spotMinutes: minutes(30, () => ({ binance: [500, 500] })), perpMinutes: minutes(30, () => ({ binance: [1000, 1000] })),
    oiContracts: [oiSeries("binance", 30, i => 100 + i)] });
  const last = rows.at(-1);
  assert.ok(last.avg > 0);
  assert.equal(last.long, last.avg); assert.equal(last.short, last.avg);
});

test("OI built while aggressive buyers dominate: long side above average, short below", () => {
  const rows = buildPerpLeverage({ timeframe: "1h", candles: candles(30),
    spotMinutes: minutes(30, () => ({ binance: [500, 500] })), perpMinutes: minutes(30, () => ({ binance: [1800, 200] })),
    oiContracts: [oiSeries("binance", 30, i => 100 + i * 5)] });
  const last = rows.at(-1);
  assert.ok(last.long > last.avg && last.short < last.avg, JSON.stringify(last));
});

test("an exchange missing spot trades (or OI) is left out of the candle entirely", () => {
  const rows = buildPerpLeverage({ timeframe: "1h", candles: candles(5),
    spotMinutes: minutes(5, () => ({ binance: [500, 500] })), // okx has no spot trades
    perpMinutes: minutes(5, () => ({ binance: [1000, 1000], okx: [9000, 1000] })),
    oiContracts: [oiSeries("binance", 5, () => 100), oiSeries("okx", 5, () => 999)] });
  assert.ok(rows.slice(1).every(row => row.exchanges.length === 1 && row.exchanges[0] === "binance"));
});

test("long liquidations reduce the long side first when OI falls", () => {
  const rows = buildPerpLeverage({ timeframe: "1h", candles: candles(4),
    spotMinutes: minutes(4, () => ({ binance: [500, 500] })), perpMinutes: minutes(4, () => ({ binance: [1000, 1000] })),
    oiContracts: [oiSeries("binance", 4, i => (i < 3 ? 100 : 80))],
    liquidations: [{ exchange: "binance", side: "long", time: 2 * H * 1000 + 60_000, usd: 2000 }] });
  assert.ok(rows.at(-2).longShare < 0.5);
});

test("per-exchange minute flows sum into candles", () => {
  const map = flowsByCandle([{ time: 0, byExchange: { a: [1, 2] } }, { time: 60, byExchange: { a: [3, 4] } }], "1h");
  assert.deepEqual(map.get(0).get("a"), [4, 6]);
});
