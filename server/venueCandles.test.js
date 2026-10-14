import test from "node:test";
import assert from "node:assert/strict";
import { parseVenueCandles, fetchVenueCandles } from "./venueCandles.js";
import { parseCandles, createCandleService, validateCandleQuery } from "./chartCandles.js";

const time = 1800000000000;
const row = [time, 100, 110, 90, 105, 2];
const contract = { symbol: "BTC_USDT", exchangeAsset: "BTC", contractSize: 0.0001 };
test("OKX base volume is index 6, not contract volume or quote turnover", () => {
  const data = parseVenueCandles("okx", { code: "0", data: [[...row, 0.02, 2.1, "1"]] }, contract);
  assert.equal(data[0][5], 0.02);
});
test("Gate.io and MEXC contract quantities convert to native base coin units", () => {
  const gate = parseVenueCandles("gate", [{ t: time / 1000, o: 100, h: 110, l: 90, c: 105, v: 20000, sum: 210 }], contract);
  const mexc = parseVenueCandles("mexc", { success: true, data: { time: [time / 1000], open: [100], high: [110],
    low: [90], close: [105], vol: [20000] } }, contract);
  assert.equal(gate[0][5], 2); assert.equal(mexc[0][5], 2);
  assert.throws(() => parseVenueCandles("mexc", { success: true, data: {} }, contract), /Invalid/);
});
test("Bitget and BingX native OHLCV pass strict common candle validation", () => {
  const bitget = parseVenueCandles("bitget", { code: "00000", data: [row] }, contract);
  const bingx = parseVenueCandles("bingx", { code: 0, data: [{ time, open: 100, high: 110, low: 90, close: 105, volume: 2 }] }, contract);
  assert.deepEqual(parseCandles("binance", bitget, "1h", time + 4000000), parseCandles("binance", bingx, "1h", time + 4000000));
  assert.throws(() => parseVenueCandles("bingx", { code: 100400, data: [] }, contract), /rejected/);
});
test("all seven exchanges validate native symbols without allowing prototype names", () => {
  for (const exchange of ["binance", "bybit", "okx", "gate", "mexc", "bitget", "bingx"])
    assert.equal(validateCandleQuery({ exchange, symbol: exchange === "okx" ? "BTC-USDT-SWAP" : "BTCUSDT" }).exchange, exchange);
  assert.throws(() => validateCandleQuery({ exchange: "__proto__" }));
  assert.throws(() => validateCandleQuery({ timeframe: "__proto__" }));
  assert.throws(() => validateCandleQuery({ exchange: "gate", symbol: "../../secret" }));
});
test("UTC daily bars and bounded native endpoint requests", async () => {
  const urls = [];
  const request = async url => { urls.push(url); return { code: "0", data: [[...row, 0.02, 2.1]] }; };
  await fetchVenueCandles(request, "okx", { ...contract, symbol: "BTC-USDT-SWAP" }, "24h", time);
  await fetchVenueCandles(request, "bitget", { ...contract, symbol: "BTCUSDT" }, "24h", time);
  assert.ok(urls[0].includes("bar=1Dutc"));
  assert.ok(urls[1].includes("granularity=1Dutc"));
});
test("new native price providers share per-series cache and preserve underlying identity", async () => {
  let calls = 0;
  const service = createCandleService({ now: () => time + 4000000, gates: {},
    contracts: { lookup: async () => ({ ...contract, symbol: "1000PEPE_USDT", exchangeAsset: "1000PEPE" }) },
    request: async () => { calls++; return [{ t: time / 1000, o: 100, h: 110, l: 90, c: 105, v: 20000 }]; },
  });
  const first = await service.get({ exchange: "gate", symbol: "1000PEPE_USDT" });
  const second = await service.get({ exchange: "gate", symbol: "1000PEPE_USDT" });
  assert.equal(first, second);
  assert.equal(first.asset, "PEPE"); assert.equal(first.priceDivisor, 1000);
  assert.equal(calls, 1);
});
