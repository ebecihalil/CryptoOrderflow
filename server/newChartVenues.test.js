import test from "node:test";
import assert from "node:assert/strict";
import { parseMarketContracts } from "./marketContracts.js";
import { parseVenueCandles, fillCandleGaps } from "./venueCandles.js";
import { parseTickers } from "./marketTickers.js";
import { derivedFrom } from "./chartCandles.js";

test("contract catalogues: Aster, Hyperliquid, KuCoin (XBT = BTC, lots), HTX (swaps only)", () => {
  assert.equal(parseMarketContracts("aster", { symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL" }] })[0].label, "BTCUSDT — Aster");
  const hl = parseMarketContracts("hyperliquid", { universe: [{ name: "ETH" }, { name: "OLD", isDelisted: true }] });
  assert.deepEqual(hl.map(c => [c.symbol, c.ticker]), [["ETH", "ETHUSDC"]]);
  const kc = parseMarketContracts("kucoin", { data: [{ symbol: "XBTUSDTM", baseCurrency: "XBT", quoteCurrency: "USDT", status: "Open", isInverse: false, multiplier: 0.001 }] });
  assert.deepEqual([kc[0].asset, kc[0].contractSize], ["BTC", 0.001]);
  const htx = parseMarketContracts("htx", { data: [{ contract_code: "BTC-USDT", symbol: "BTC", contract_size: 0.001, contract_status: 1, business_type: "swap" },
    { contract_code: "BTC-USDT-261226", symbol: "BTC", contract_size: 0.001, contract_status: 1, business_type: "futures" }] });
  assert.deepEqual(htx.map(c => c.symbol), ["BTC-USDT"]);
});

test("candles: coin volume per venue and flat zero-volume bars for minutes without trades", () => {
  assert.deepEqual(parseVenueCandles("hyperliquid", [{ t: 60_000, o: "1", h: "2", l: "0.5", c: "1.5", v: "3" }], {}), [[60_000, "1", "2", "0.5", "1.5", "3"]]);
  assert.equal(parseVenueCandles("kucoin", { data: [[60_000, 1, 2, 0.5, 1.5, 10]] }, { contractSize: 0.01 })[0][5], 0.1);
  assert.deepEqual(parseVenueCandles("htx", { data: [{ id: 60, open: 1, high: 2, low: 0.5, close: 1.5, amount: 4 }] }, {})[0], [60_000, 1, 2, 0.5, 1.5, 4]);
  const filled = fillCandleGaps([[0, 1, 1, 1, 1, 5], [180_000, 2, 2, 2, 2, 5]], 60_000);
  assert.deepEqual(filled.map(r => r[0]), [0, 60_000, 120_000, 180_000]);
  assert.deepEqual(filled[1], [60_000, 1, 1, 1, 1, 0]);
});

test("tickers and derived timeframes for the new venues", () => {
  const hl = parseTickers("hyperliquid", [{ universe: [{ name: "BTC" }] }, [{ markPx: "110", prevDayPx: "100", dayNtlVlm: "5" }]]);
  assert.deepEqual(hl, [["BTC", 110, 10, 5]]);
  assert.deepEqual(parseTickers("kucoin", { data: [{ symbol: "XBTUSDTM", lastTradePrice: 60000, priceChgPct: 0.02, turnoverOf24h: 9 }] }), [["XBTUSDTM", 60000, 2, 9]]);
  assert.equal(derivedFrom("kucoin", "3m"), "1m");
  assert.equal(derivedFrom("htx", "1w"), "24h");
  assert.equal(derivedFrom("aster", "1w"), null, "Aster publishes weekly candles like Binance");
  assert.equal(derivedFrom("hyperliquid", "1h"), null);
});
