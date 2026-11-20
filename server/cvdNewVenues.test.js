import test from "node:test";
import assert from "node:assert/strict";
import { parseCvdTrades } from "./cvdTradeCodec.js";
import { parseCvdMarkets, cvdExchangesFor, CVD_EXCHANGES } from "./cvdMarkets.js";
import { cvdSubscription } from "./cvdStreams.js";

const inst = (exchange, symbol, extra = {}) => ({ exchange, market: "perpetual", symbol, priceDivisor: 1, ...extra });

test("15 perpetual trade venues; 11 spot venues (CoinEx has both)", () => {
  assert.equal(cvdExchangesFor("perpetual").length, 15);
  assert.equal(cvdExchangesFor("spot").length, 11);
  assert.ok(cvdExchangesFor("spot").includes("coinex"));
  for (const exchange of ["aster", "hyperliquid", "bitmex", "deribit"]) {
    assert.ok(CVD_EXCHANGES.includes(exchange));
    assert.ok(!cvdExchangesFor("spot").includes(exchange));
  }
});

test("new venue trades parse to side, price and coin quantity", () => {
  const aster = parseCvdTrades("aster", "perpetual", { e: "aggTrade", s: "BTCUSDT", a: 7, T: 1_700_000_000_000, m: false, p: "60000", q: "0.5" }, inst("aster", "BTCUSDT"));
  assert.deepEqual([aster[0].side, aster[0].price, aster[0].value], ["buy", 60000, 30000]);
  const hl = parseCvdTrades("hyperliquid", "perpetual", { channel: "trades", data: [
    { coin: "BTC", side: "A", px: "60000", sz: "0.1", time: 1_700_000_000_000, tid: 11 },
    { coin: "ETH", side: "B", px: "3000", sz: "1", time: 1_700_000_000_000, tid: 12 }] }, inst("hyperliquid", "BTC"));
  assert.equal(hl.length, 1); assert.equal(hl[0].side, "sell"); assert.equal(hl[0].value, 6000);
  const bitmex = parseCvdTrades("bitmex", "perpetual", { table: "trade", action: "insert", data: [
    { symbol: "XBTUSD", side: "Buy", size: 6000, price: 60000, homeNotional: 0.1, trdMatchID: "abc", timestamp: "2026-11-20T10:00:00.000Z" }] }, inst("bitmex", "XBTUSD"));
  assert.equal(bitmex[0].quantity, 0.1); assert.equal(bitmex[0].value, 6000); assert.equal(bitmex[0].time, Date.parse("2026-11-20T10:00:00.000Z"));
  const deribit = parseCvdTrades("deribit", "perpetual", { method: "subscription", params: { channel: "trades.BTC-PERPETUAL.100ms",
    data: [{ trade_id: "1", timestamp: 1_700_000_000_000, direction: "sell", price: 60000, amount: 12000 }] } }, inst("deribit", "BTC-PERPETUAL", { inverse: true }));
  assert.equal(deribit[0].quantity, 0.2, "inverse: USD amount / price = coins"); assert.equal(deribit[0].value, 12000);
  const coinex = parseCvdTrades("coinex", "perpetual", { method: "deals.update", data: { market: "BTCUSDT",
    deal_list: [{ deal_id: 5, created_at: 1_700_000_000_000, side: "buy", price: "60000", amount: "0.01" }] } }, inst("coinex", "BTCUSDT"));
  assert.equal(coinex[0].value, 600);
});

test("new venue catalogues and subscriptions", () => {
  assert.equal(parseCvdMarkets("hyperliquid", "perpetual", { universe: [{ name: "BTC" }, { name: "OLD", isDelisted: true }] })[0].symbol, "BTC");
  const bitmex = parseCvdMarkets("bitmex", "perpetual", [{ symbol: "XBTUSD", underlying: "XBT", quoteCurrency: "USD", state: "Open", typ: "FFWCSX" },
    { symbol: "XBTZ26", underlying: "XBT", quoteCurrency: "USD", state: "Open", typ: "FFCCSX" }]);
  assert.deepEqual(bitmex.map(m => [m.symbol, m.asset]), [["XBTUSD", "BTC"]]);
  const deribit = parseCvdMarkets("deribit", "perpetual", { result: [{ instrument_name: "BTC-PERPETUAL", base_currency: "BTC", quote_currency: "USD" },
    { instrument_name: "BTC-27DEC26", base_currency: "BTC", quote_currency: "USD" }] });
  assert.equal(deribit.length, 1); assert.equal(deribit[0].inverse, true);
  assert.deepEqual(cvdSubscription("hyperliquid", "perpetual", "BTC", 1, 0), { method: "subscribe", subscription: { type: "trades", coin: "BTC" } });
  assert.deepEqual(cvdSubscription("bitmex", "perpetual", "XBTUSD", 1, 0), { op: "subscribe", args: ["trade:XBTUSD"] });
});
