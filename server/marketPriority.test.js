import test from "node:test";
import assert from "node:assert/strict";
import { groupByPriority, normalizeOrder } from "../src/lib/market-priority.js";

const c = (exchange, asset) => ({ exchange, asset, symbol: `${asset}-${exchange}` });
const contracts = [
  c("binance", "BTC"), c("bybit", "BTC"), c("okx", "BTC"),
  c("binance", "ONLYBIN"), c("okx", "ONLYOKX"), c("okx", "BOTH"), c("binance", "BOTH"), c("gate", "GATEONLY"),
];

test("each coin once, from the highest-priority exchange that lists it", () => {
  const groups = groupByPriority(contracts, ["bybit", "binance", "okx", "gate"], ["bybit", "binance", "okx", "gate"]);
  const pick = Object.fromEntries(groups.map(g => [g.primary.asset, g.primary.exchange]));
  assert.deepEqual(pick, { BTC: "bybit", ONLYBIN: "binance", ONLYOKX: "okx", BOTH: "binance", GATEONLY: "gate" });
  assert.deepEqual(groups.find(g => g.primary.asset === "BTC").others.map(o => o.exchange), ["binance", "okx"]);
});

test("disabled exchanges are skipped and hidden coins removed", () => {
  const groups = groupByPriority(contracts, ["bybit", "binance", "okx", "gate"], ["bybit", "okx"], x => x.asset === "BOTH");
  const pick = Object.fromEntries(groups.map(g => [g.primary.asset, g.primary.exchange]));
  assert.deepEqual(pick, { BTC: "bybit", ONLYOKX: "okx" });
});

test("saved order keeps known exchanges and appends new ones", () => {
  assert.deepEqual(normalizeOrder(["okx", "nope", "bybit", "okx"], ["binance", "bybit", "okx", "gate"]), ["okx", "bybit", "binance", "gate"]);
  assert.deepEqual(normalizeOrder(null, ["a", "b"]), ["a", "b"]);
});

test("ten priority slots: defaults, legacy conversion, swaps and moves", async () => {
  const { normalizeSlots, assignSlot, moveSlot } = await import("../src/lib/market-priority.js");
  const supported = ["binance", "bybit", "okx", "gate"];
  const def = ["binance", "bybit", "okx", "gate"];
  assert.deepEqual(normalizeSlots(undefined, supported, def), ["binance", "bybit", "okx", "gate", null, null, null, null, null, null]);
  assert.deepEqual(normalizeSlots(["okx", "okx", "nope", null, "bybit"], supported, def).slice(0, 5), ["okx", null, null, null, "bybit"]);
  assert.deepEqual(normalizeSlots(undefined, supported, def, { order: ["bybit", "binance", "okx", "gate"], exchanges: ["bybit", "okx"] }).slice(0, 3),
    ["bybit", "okx", null]);
  const slots = ["binance", "bybit", null, "okx"];
  assert.deepEqual(assignSlot(slots, 2, "okx"), ["binance", "bybit", "okx", null], "taking an exchange from another slot swaps them");
  assert.deepEqual(assignSlot(slots, 0, null), [null, "bybit", null, "okx"]);
  assert.deepEqual(moveSlot(slots, 1, -1), ["bybit", "binance", null, "okx"]);
  assert.deepEqual(moveSlot(slots, 0, -1), slots);
});

test("aggregated volume drops a gappy venue instead of cutting history short", async () => {
  const { aggregateCandleVolumes } = await import("./candleVolumeMath.js");
  const bars = n => Array.from({ length: n }, (_, i) => ({ time: i * 60, open: 1, high: 1, low: 1, close: 1, volume: 1, closed: true }));
  const price = { candles: bars(400) };
  const full = { exchange: "binance", divisor: 1, candles: bars(400) };
  const okx = { exchange: "okx", divisor: 1, candles: bars(400) };
  const gappy = { exchange: "bingx", divisor: 1, candles: bars(400).filter(bar => bar.time !== 390 * 60) };
  const result = aggregateCandleVolumes(price, [full, okx, gappy], "1m");
  assert.deepEqual(result.exchanges, ["binance", "okx"], "the venue missing a recent bar is left out");
  assert.equal(result.candles.length, 400);
  assert.equal(result.candles[0].volume, 2);
  const complete = aggregateCandleVolumes(price, [full, okx, { ...gappy, candles: bars(400) }], "1m");
  assert.deepEqual(complete.exchanges, ["binance", "okx", "bingx"]);
  assert.equal(complete.candles.at(-1).volume, 3);
});

test("aggregated volume uses all seven chart venues by default", async () => {
  const { VOLUME_EXCHANGES } = await import("./candleVolumeMath.js");
  assert.deepEqual([...VOLUME_EXCHANGES].sort(), ["binance", "bingx", "bitget", "bybit", "gate", "mexc", "okx"]);
});
