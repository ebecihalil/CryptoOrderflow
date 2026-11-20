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
