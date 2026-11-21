import test from "node:test";
import assert from "node:assert/strict";
import { createMarketTickerService, parseTickers } from "./marketTickers.js";

test("parses every venue's bulk ticker into last price and 24h change percent", () => {
  assert.deepEqual(parseTickers("binance", [{ symbol: "BTCUSDT", lastPrice: "60000", priceChangePercent: "2.5", quoteVolume: "1000" }]),
    [["BTCUSDT", 60000, 2.5, 1000]]);
  assert.deepEqual(parseTickers("bybit", { result: { list: [{ symbol: "BTCUSDT", lastPrice: "60000", price24hPcnt: "0.025", turnover24h: "9" }] } }),
    [["BTCUSDT", 60000, 2.5, 9]]);
  assert.deepEqual(parseTickers("okx", { code: "0", data: [{ instId: "BTC-USDT-SWAP", last: "110", open24h: "100", volCcy24h: "2" }] }),
    [["BTC-USDT-SWAP", 110, 10, 220]]);
  assert.deepEqual(parseTickers("gate", [{ contract: "BTC_USDT", last: "60000", change_percentage: "-1.2", volume_24h_quote: "5" }]),
    [["BTC_USDT", 60000, -1.2, 5]]);
  assert.deepEqual(parseTickers("mexc", { data: [{ symbol: "BTC_USDT", lastPrice: 60000, riseFallRate: -0.0335, amount24: 7 }] }),
    [["BTC_USDT", 60000, -3.35, 7]]);
  assert.deepEqual(parseTickers("bitget", { code: "00000", data: [{ symbol: "BTCUSDT", lastPr: "60000", change24h: "0.01", usdtVolume: "3" }] }),
    [["BTCUSDT", 60000, 1, 3]]);
  assert.deepEqual(parseTickers("bingx", { code: 0, data: [{ symbol: "BTC-USDT", lastPrice: "60000", priceChangePercent: "4.2", quoteVolume: "8" }] }),
    [["BTC-USDT", 60000, 4.2, 8]]);
});

test("skips rows without a positive price and rejects error bodies", () => {
  assert.deepEqual(parseTickers("binance", [{ symbol: "X", lastPrice: "0" }, { symbol: "Y" }]), []);
  assert.throws(() => parseTickers("okx", { code: "50011", data: [] }));
  assert.throws(() => parseTickers("bybit", { retMsg: "error" }));
});

test("one bulk request per exchange per refresh window, shared across viewers", async () => {
  let clock = 1_000_000;
  const calls = [];
  const service = createMarketTickerService({
    now: () => clock, gates: {}, dailyOpens: { get: () => null, set() {} },
    request: async url => { calls.push(url); return url.includes("binance") ? [{ symbol: "BTCUSDT", lastPrice: "1", priceChangePercent: "1" }] : url.includes("gateio") || url.includes("asterdex") ? []
      : url.includes("hyperliquid") ? [{ universe: [] }, []] : { code: 0, data: [], result: { list: [] } }; },
  });
  service.get(); service.get(); service.get();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 11);
  const payload = service.get();
  assert.equal(payload.exchanges.binance.status, "ok");
  assert.deepEqual(payload.exchanges.binance.rows, [["BTCUSDT", 1, 1, null, null]]);
  clock += 31_000; service.get(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(url => url.includes("binance")).length, 1, "Binance refreshes every 60s");
  assert.equal(calls.length, 21);
});

test("market list price decimals follow the price size", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/components/market-list.tsx", import.meta.url), "utf8");
  assert.match(source, /export function priceDecimals/);
  // Mirror of priceDecimals: 62782.00 · 5.8716 · 0.2384 · 0.05342 · 0.0001234
  const decimals = abs => abs >= 100 ? 2 : Math.min(10, Math.max(2, (abs >= 1 ? 4 : 3) - Math.floor(Math.log10(abs))));
  assert.deepEqual([62782, 5.8716, 47.5, 0.2384, 0.05342, 0.0001234].map(decimals), [2, 4, 3, 4, 5, 7]);
  assert.match(source, /formatPrice\(row\.change, row\.last \?\? row\.change\)/, "change uses the price's decimals");
});

test("change since 00:00 UTC: exchange-published opens (OKX sodUtc0, Bitget openUtc) and fetched daily candles", async () => {
  const { parseDailyOpen, createDailyOpenService, dayStartMs } = await import("./dailyOpens.js");
  assert.deepEqual(parseTickers("okx", { code: "0", data: [{ instId: "X-USDT-SWAP", last: "110", open24h: "80", sodUtc0: "100", volCcy24h: "1" }] }),
    [["X-USDT-SWAP", 110, 37.5, 110, 100]]);
  const day = dayStartMs(Date.UTC(2026, 10, 21, 15));
  assert.equal(parseDailyOpen("binance", [[day, "2.5", "3", "2", "2.8", "10"]], day), 2.5);
  assert.equal(parseDailyOpen("bybit", { result: { list: [[String(day), "4", "5", "3", "4.5", "1"]] } }, day), 4);
  assert.equal(parseDailyOpen("binance", [[day - 86_400_000, "2.5"]], day), null, "yesterday's candle is not used");
  const calls = [];
  const service = createMarketTickerService({ now: () => day + 3600_000, gates: {},
    request: async url => { calls.push(url); return url.includes("klines") ? [[day, "1.00", "1", "1", "1", "1"]]
      : url.includes("binance") ? [{ symbol: "BTCUSDT", lastPrice: "1.25", priceChangePercent: "40" }] : url.includes("gateio") || url.includes("asterdex") ? []
      : url.includes("hyperliquid") ? [{ universe: [] }, []] : { code: 0, data: [], result: { list: [] } }; } });
  service.get(); await new Promise(resolve => setImmediate(resolve));
  service.get(); await new Promise(resolve => setImmediate(resolve));
  const row = service.get().exchanges.binance.rows[0];
  assert.equal(row[2], 40, "rolling 24h change kept");
  assert.equal(row[4], 25, "since 00:00 UTC: 1.25 vs 1.00");
  assert.equal(calls.filter(url => url.includes("klines")).length, 1, "one daily candle per contract per day");
});
