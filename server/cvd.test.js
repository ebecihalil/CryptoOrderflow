import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { gzipSync } from "node:zlib";
import { parseCvdMarkets, createCvdMarketResolver, CVD_EXCHANGES } from "./cvdMarkets.js";
import { decodeTradeMessage, parseCvdTrades, mexcTradeType } from "./cvdTradeCodec.js";
import { cvdAnchorStart, newCvdMinute, addCvdTrade, buildCvdCandles, validateCvdQuery } from "./cvdMath.js";
import { createCvdIndicatorService } from "./cvdIndicator.js";
import { cvdSubscription, createCvdStreamFactory } from "./cvdStreams.js";
import { createExchangeHttpClient, exchangeForUrl } from "./exchangeHttpClient.js";

const T = Date.parse("2026-10-14T12:01:00Z");
function fixture(exchange, market, side) {
  const maker = side === "sell", symbol = exchange === "kraken" ? market === "spot" ? "BTC/USD" : "PF_XBTUSD" :
    exchange === "htx" ? market === "spot" ? "btcusdt" : "BTC-USDT" :
    exchange === "kucoin" ? market === "spot" ? "BTC-USDT" : "XBTUSDTM" :
    exchange === "okx" ? market === "spot" ? "BTC-USDT" : "BTC-USDT-SWAP" :
    exchange === "gate" || exchange === "mexc" && market === "perpetual" ? "BTC_USDT" :
    exchange === "bingx" ? "BTC-USDT" : "BTCUSDT";
  const instrument = { symbol, contractSize: ["okx", "gate", "mexc", "kucoin", "htx"].includes(exchange) && market === "perpetual" ? 0.1 : 1 };
  const messages = {
    binance: { e: "aggTrade", s: symbol, a: "123", T, m: maker, p: "100", q: "2" },
    bybit: { topic: `publicTrade.${symbol}`, data: [{ i: "123", T, S: side === "buy" ? "Buy" : "Sell", p: "100", v: "2" }] },
    okx: { arg: { channel: "trades", instId: symbol }, data: [{ tradeId: "123", ts: T, side, px: "100", sz: "2" }] },
    gate: { channel: market === "spot" ? "spot.trades" : "futures.trades", event: "update",
      result: [{ id: "123", currency_pair: symbol, contract: symbol, create_time_ms: String(T),
        side, price: "100", amount: "2", size: side === "buy" ? "2" : "-2" }] },
    mexc: market === "spot" ? { symbol, publicAggreDeals: { deals: [{ tradeId: "123", time: T, tradeType: maker ? 2 : 1, price: "100", quantity: "2" }] } } :
      { symbol, channel: "push.deal", data: [{ i: "123", t: T, T: maker ? 2 : 1, p: 100, v: 2, O: 3 }] },
    bitget: { arg: { channel: "trade", instId: symbol }, data: [{ tradeId: "123", ts: T, side, price: "100", size: "2" }] },
    bingx: { dataType: `${symbol}@trade`, data: { t: "123", T, m: maker, p: "100", q: "2" } },
    kucoin: { type: "message", topic: `${market === "spot" ? "/market/match" : "/contractMarket/execution"}:${symbol}`,
      data: { tradeId: "123", ts: String(BigInt(T) * 1_000_000n), side, price: "100", size: "2" } },
    kraken: market === "spot" ? { channel: "trade", type: "update", data: [{ trade_id: "123", timestamp: new Date(T).toISOString(), symbol, side, price: 100, qty: 2 }] } :
      { feed: "trade", product_id: symbol, uid: "123", time: T, side, price: 100, qty: 2, type: "fill" },
    htx: { ch: `market.${symbol}.trade.detail`, tick: { data: [{ id: "123", ts: T, direction: side, price: 100, amount: 2 }] } },
  };
  return { instrument, message: messages[exchange] };
}
for (const exchange of CVD_EXCHANGES) for (const market of ["spot", "perpetual"]) {
  test(`${exchange} ${market}: documented taker direction and quote/contract units`, () => {
    for (const side of ["buy", "sell"]) {
      const { instrument, message } = fixture(exchange, market, side);
      const [trade] = parseCvdTrades(exchange, market, message, instrument);
      assert.equal(trade.side, side); assert.equal(trade.time, T);
      assert.equal(trade.value, 200 * (market === "spot" ? 1 : instrument.contractSize));
      assert.equal(trade.id, "123");
    }
  });
}
test("MEXC binary schema, gzip heartbeats and unsafe execution IDs are decoded without rounding", () => {
  const f = fixture("mexc", "spot", "buy");
  const raw = mexcTradeType.encode(mexcTradeType.fromObject(f.message)).finish();
  const decoded = decodeTradeMessage("mexc", "spot", Buffer.from(raw));
  assert.equal(parseCvdTrades("mexc", "spot", decoded, f.instrument)[0].value, 200);
  assert.deepEqual(decodeTradeMessage("htx", "spot", gzipSync('{"ping":123}')), { ping: 123 });
  assert.equal(decodeTradeMessage("gate", "spot", '{"id":9007199254740993}').id, "9007199254740993");
  assert.deepEqual(decodeTradeMessage("bingx", "spot", gzipSync("Ping")), { heartbeat: "Ping" });
});
test("malformed/unknown sides, wrong symbols and Kraken snapshots/block trades never enter CVD", () => {
  const f = fixture("binance", "spot", "buy");
  assert.equal(parseCvdTrades("binance", "spot", { ...f.message, m: undefined }, f.instrument).length, 0);
  assert.equal(parseCvdTrades("binance", "spot", { ...f.message, s: "OTHER" }, f.instrument).length, 0);
  const k = fixture("kraken", "spot", "buy");
  assert.equal(parseCvdTrades("kraken", "spot", { ...k.message, type: "snapshot" }, k.instrument).length, 0);
  const p = fixture("kraken", "perpetual", "buy");
  assert.equal(parseCvdTrades("kraken", "perpetual", { ...p.message, type: "block" }, p.instrument).length, 0);
});
test("verified live MEXC singleton deals and ID-less BingX perp records retain legitimate fills", () => {
  const m = fixture("mexc", "perpetual", "buy");
  m.message.data = m.message.data[0];
  assert.equal(parseCvdTrades("mexc", "perpetual", m.message, m.instrument)[0].value, 20);
  const b = fixture("bingx", "perpetual", "buy");
  delete b.message.data.t;
  b.message.data = [b.message.data, { ...b.message.data }];
  const trades = parseCvdTrades("bingx", "perpetual", b.message, b.instrument, "session:1");
  assert.equal(trades.length, 2);
  assert.notEqual(trades[0].id, trades[1].id);
});
test("multipliers identify the same asset without double-scaling trade notional", () => {
  const markets = parseCvdMarkets("binance", "spot", { symbols: [{ symbol: "1000PEPEUSDT", baseAsset: "1000PEPE", quoteAsset: "USDT", status: "TRADING" }] });
  assert.equal(markets[0].asset, "PEPE"); assert.equal(markets[0].priceDivisor, 1000);
  const f = fixture("binance", "spot", "buy");
  f.instrument.symbol = "1000PEPEUSDT"; f.message.s = f.instrument.symbol;
  f.message.p = "0.01"; f.message.q = "1000";
  assert.equal(parseCvdTrades("binance", "spot", f.message, f.instrument)[0].value, 10);
});
test("metadata selection is cached/coalesced, crypto-only and never synthesizes absent symbols", async () => {
  let calls = 0;
  const r = createCvdMarketResolver({ request: async () => { calls++; return { symbols: [
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" },
    { symbol: "QQQUSDT", baseAsset: "QQQ", quoteAsset: "USDT", status: "TRADING" },
  ] }; } });
  const [a, b] = await Promise.all([r.resolve("binance", "spot", "BTC"), r.resolve("binance", "spot", "BTC")]);
  assert.equal(calls, 1); assert.deepEqual(a, b);
  assert.equal(await r.resolve("binance", "spot", "PEPE"), null);
  assert.equal(await r.resolve("binance", "spot", "QQQ"), null);
});
test("UTC calendar anchors match 1D, Monday weeks, month, quarter, half-year and year", () => {
  const at = T / 1000;
  const expected = { "1d": "2026-10-14", "1w": "2026-10-12", "1m": "2026-10-01", "3m": "2026-10-01", "6m": "2026-07-01", "1y": "2026-01-01" };
  for (const [anchor, day] of Object.entries(expected)) assert.equal(new Date(cvdAnchorStart(at, anchor) * 1000).toISOString(), `${day}T00:00:00.000Z`);
});
test("actual execution sequence produces CVD OHLC, signed totals, gaps and anchor resets", () => {
  const m = newCvdMinute(T / 1000);
  [100, -250, 200].forEach(n => addCvdTrade(m, { exchange: "binance", side: n > 0 ? "buy" : "sell", value: Math.abs(n) }));
  const next = addCvdTrade(newCvdMinute(T / 1000 + 60), { exchange: "bybit", side: "sell", value: 10 });
  const [c] = buildCvdCandles([m, next], "5m", "3m", T / 1000 + 180);
  assert.deepEqual([c.open, c.high, c.low, c.close], [0, 100, -150, 40]);
  assert.equal(c.buyValue, 300); assert.equal(c.sellValue, 260); assert.equal(c.sourceCount, 2);
  const gap = addCvdTrade(newCvdMinute(T / 1000 + 600, true), { exchange: "bybit", side: "buy", value: 5 });
  const candles = buildCvdCandles([m, gap], "5m", "3m", T / 1000 + 800);
  assert.equal(candles.length, 2); assert.equal(candles[1].open, 50); assert.equal(candles[1].close, 55);
  assert.equal(candles[1].segmentStart, false); assert.equal(candles[1].partial, true);
  const feb = addCvdTrade(newCvdMinute(Date.parse("2027-01-01") / 1000), { exchange: "bybit", side: "buy", value: 2 });
  assert.equal(buildCvdCandles([m, feb], "1h", "3m", feb.time + 20)[1].open, 0);
});
for (const [timeframe, seconds] of Object.entries({ "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "24h": 86400 })) {
  test(`CVD ${timeframe}: later observed candle opens at prior close even after a feed gap`, () => {
    const start = Math.floor(T / 1000 / seconds) * seconds;
    const a = newCvdMinute(start);
    addCvdTrade(a, { exchange: "binance", side: "buy", value: 100 });
    addCvdTrade(a, { exchange: "bybit", side: "sell", value: 25 });
    const b = newCvdMinute(start + seconds * 2, true);
    addCvdTrade(b, { exchange: "binance", side: "sell", value: 50 });
    addCvdTrade(b, { exchange: "okx", side: "buy", value: 10 });
    const candles = buildCvdCandles([a, b], timeframe, "1w", b.time + seconds);
    assert.equal(candles.length, 2, "unknown intervals must not produce invented candles");
    assert.deepEqual([candles[0].open, candles[0].close], [0, 75]);
    assert.deepEqual([candles[1].open, candles[1].high, candles[1].low, candles[1].close], [75, 75, 25, 35]);
    assert.equal(candles[1].open, candles[0].close);
    assert.equal(candles[1].segmentStart, false);
  });
}
test("a mid-candle coverage change preserves earlier executions, extrema and cumulative balance", () => {
  const start = Math.floor(T / 1000 / 3600) * 3600;
  const a = addCvdTrade(newCvdMinute(start), { exchange: "binance", side: "buy", value: 100 });
  const b = addCvdTrade(newCvdMinute(start + 60, true), { exchange: "bybit", side: "sell", value: 150 });
  const c = addCvdTrade(newCvdMinute(start + 120, true), { exchange: "okx", side: "buy", value: 75 });
  const d = addCvdTrade(newCvdMinute(start + 3600), { exchange: "binance", side: "buy", value: 10 });
  const candles = buildCvdCandles([a, b, c, d], "1h", "1w", d.time + 60);
  assert.deepEqual([candles[0].open, candles[0].high, candles[0].low, candles[0].close], [0, 100, -50, 25]);
  assert.equal(candles[0].trades, 3);
  assert.equal(candles[0].buyValue, 175); assert.equal(candles[0].sellValue, 150);
  assert.equal(candles[0].sourceCount, 3);
  assert.equal(candles[1].open, 25); assert.equal(candles[1].close, 35);
  assert.deepEqual(buildCvdCandles([a, b, c, d], "1h", "1w", d.time + 60), candles);
});
test("weekly anchor resets only at Monday UTC, not at reconnects", () => {
  const before = addCvdTrade(newCvdMinute(Date.parse("2026-10-18T23:59:00Z") / 1000), { exchange: "binance", side: "buy", value: 80 });
  const after = addCvdTrade(newCvdMinute(Date.parse("2026-10-19T00:00:00Z") / 1000, true), { exchange: "bybit", side: "sell", value: 15 });
  const candles = buildCvdCandles([before, after], "1h", "1w", after.time + 60);
  assert.equal(candles[0].close, 80);
  assert.equal(candles[1].open, 0); assert.equal(candles[1].close, -15);
  assert.equal(candles[1].segmentStart, true);
});
test("query validation rejects arrays, invalid markets/anchors and inherited keys", () => {
  assert.equal(validateCvdQuery({ asset: "BTC" }).anchor, "1w");
  for (const query of [{ asset: ["BTC"] }, { asset: "BTC", market: "both" }, { asset: "BTC", anchor: "90d" }, { asset: "../BTC" }, { asset: "BTC", timeframe: "constructor" }]) {
    assert.throws(() => validateCvdQuery(query));
  }
});
test("collector reuses sockets across refreshes, separates spot/perp and deduplicates executions", async () => {
  let clock = T, opened = 0;
  const handlers = new Map();
  const svc = createCvdIndicatorService({ now: () => clock, storageDir: null, timers: false,
    resolver: { resolve: async (exchange, market) => exchange === "binance" ? { exchange, market, symbol: "BTCUSDT", contractSize: 1 } : null },
    streams: { start: async (i, trade, state) => { opened++; handlers.set(i.market, trade); state("idle"); return { stop() {} }; } } });
  svc.get({ asset: "BTC", market: "spot" }); await new Promise(r => setImmediate(r));
  svc.get({ asset: "BTC", market: "spot", anchor: "1d" });
  assert.equal(opened, 1);
  const trade = { id: "1", exchange: "binance", symbol: "BTCUSDT", time: clock, side: "buy", value: 100 };
  handlers.get("spot")(trade); handlers.get("spot")(trade);
  clock += 3000;
  assert.equal(svc.get({ asset: "BTC", market: "spot" }).candles[0].close, 100);
  assert.equal(svc.get({ asset: "BTC", market: "spot" }).sources[0].tradeCount, 1);
  svc.get({ asset: "BTC", market: "perpetual" }); await new Promise(r => setImmediate(r));
  assert.equal(opened, 2);
  assert.equal(svc.get({ asset: "BTC", market: "perpetual" }).candles.length, 0);
  await svc.close();
});
test("recorded real minutes survive restart with explicit gap instead of invented backfill", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cvd-"));
  let clock = T, handler;
  const options = { now: () => clock, storageDir: dir, timers: false,
    resolver: { resolve: async e => e === "binance" ? { exchange: e, market: "spot", symbol: "BTCUSDT", contractSize: 1 } : null },
    streams: { start: async (_i, callback) => { handler = callback; return { stop() {} }; } } };
  const a = createCvdIndicatorService(options);
  a.get({ asset: "BTC", market: "spot" }); await a._groups.get("spot:BTC").ready;
  handler({ id: "1", exchange: "binance", symbol: "BTCUSDT", time: clock, side: "sell", value: 12 });
  clock += 3000; a.get({ asset: "BTC", market: "spot" }); await a.close();
  clock += 600000;
  const b = createCvdIndicatorService(options);
  b.get({ asset: "BTC", market: "spot" }); await b._groups.get("spot:BTC").ready;
  assert.equal(b.get({ asset: "BTC", market: "spot" }).candles[0].close, -12);
  assert.equal(b.get({ asset: "BTC", market: "spot" }).completeAnchor, false);
  await b.close(); await rm(dir, { recursive: true });
});
test("every venue uses a public market subscription, with no private credentials", () => {
  for (const exchange of CVD_EXCHANGES) for (const market of ["spot", "perpetual"]) {
    const payload = cvdSubscription(exchange, market, "BTCUSDT", 1, T);
    assert.equal(typeof payload, "object");
    assert.doesNotMatch(JSON.stringify(payload), /apiKey|signature|secret/);
  }
});
test("new spot REST hosts enter existing shared limiters and Kraken empty error array is success", async () => {
  for (const [host, ex] of [["api.binance.com", "binance"], ["api.kucoin.com", "kucoin"], ["api.kraken.com", "kraken"], ["api.huobi.pro", "htx"]]) {
    assert.equal(exchangeForUrl(`https://${host}/`), ex);
  }
  let entered = 0;
  const client = createExchangeHttpClient({
    gates: { kraken: { enter: async () => entered++, inspect: async () => {} } },
    fetchImpl: async () => new Response(JSON.stringify({ error: [], result: { BTC: {} } })),
  });
  assert.deepEqual((await client("https://api.kraken.com/0/public/AssetPairs")).error, []);
  assert.equal(entered, 1);
});

test("socket admission shares limiter, Gate preserves decimal lots and stop prevents reconnect", async () => {
  const sockets = [];
  class FakeSocket extends EventEmitter {
    constructor(url, options) { super(); this.url = url; this.options = options; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(message) { this.sent.push(message); }
    close() { this.emit("close"); }
    ping() {}
  }
  let admissions = 0;
  const streams = createCvdStreamFactory({ Socket: FakeSocket, now: () => T, wait: async () => {},
    gates: { gate: { enter: async () => { admissions++; }, isCoolingDown: false } } });
  const handle = await streams.start({ exchange: "gate", market: "perpetual", symbol: "BTC_USDT", contractSize: 0.001 }, () => {}, () => {});
  await new Promise(r => setImmediate(r));
  sockets[0].emit("open");
  assert.equal(admissions, 1);
  assert.equal(sockets[0].options.headers["X-Gate-Size-Decimal"], "1");
  assert.equal(JSON.parse(sockets[0].sent[0]).channel, "futures.trades");
  handle.stop();
  await new Promise(r => setImmediate(r));
  assert.equal(sockets.length, 1);
});
