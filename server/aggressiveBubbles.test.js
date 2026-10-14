import test from "node:test";
import assert from "node:assert/strict";
import { createAggressiveBubbleLedger, validateAggressiveBubblesQuery } from "./aggressiveBubbles.js";
import { createCvdIndicatorService } from "./cvdIndicator.js";
import { parseCvdTrades } from "./cvdTradeCodec.js";

const T = Date.parse("2026-10-14T14:01:00Z");
const trade = (overrides = {}) => ({ id: "1", exchange: "binance", symbol: "BTCUSDT",
  time: T, side: "buy", value: 100, price: 100, ...overrides });

test("gross buys and sells form separate bubbles even when net CVD is zero", () => {
  const ledger = createAggressiveBubbleLedger({ market: "spot", now: () => T });
  ledger.add(trade()); ledger.add(trade({ side: "sell", id: "2" }));
  const { points } = ledger.snapshot("5m", 0);
  assert.equal(points.length, 2);
  assert.equal(points.find(p => p.side === "buy").value, 100);
  assert.equal(points.find(p => p.side === "sell").value, 100);
  assert.equal(points[0].price, 100);
  assert.equal(points[0].time, Math.floor(T / 1000 / 300) * 300);
});
test("same-price executions aggregate across exchanges without losing quantities or source counts", () => {
  const ledger = createAggressiveBubbleLedger({ market: "perpetual", now: () => T + 60000 });
  ledger.add(trade({ price: 100, value: 100 }));
  ledger.add(trade({ price: 100.01, value: 200.02, time: T + 60000, exchange: "bybit", id: "2" }));
  const { points } = ledger.snapshot("5m", 0);
  assert.equal(points.length, 1);
  assert.equal(points[0].value, 300.02); assert.equal(points[0].tradeCount, 2);
  assert.equal(points[0].sourceCount, 2);
  assert.ok(Math.abs(points[0].price - 300.02 / 3) < 1e-10);
  assert.equal(ledger.snapshot("5m", 301).points.length, 0);
  assert.equal(ledger.snapshot("5m", 300).points.length, 1);
});
test("chart timeframe regrouping changes coordinates but preserves gross executed value", () => {
  const ledger = createAggressiveBubbleLedger({ market: "spot", now: () => T + 600000 });
  ledger.add(trade()); ledger.add(trade({ time: T + 600000, id: "2" }));
  assert.equal(ledger.snapshot("5m", 0).points.length, 2);
  assert.equal(ledger.snapshot("1h", 0).points.length, 1);
  assert.equal(ledger.snapshot("1h", 0).points[0].value, 200);
});
test("bundled native contract prices convert to underlying prices without changing notional", () => {
  const [t] = parseCvdTrades("binance", "perpetual",
    { e: "aggTrade", s: "1000PEPEUSDT", a: "1", T, m: false, p: "0.01", q: "100" },
    { symbol: "1000PEPEUSDT", contractSize: 1, priceDivisor: 1000 });
  assert.equal(t.price, 0.00001); assert.equal(t.quantity, 100000); assert.equal(t.value, 1);
  assert.equal(t.price * 1000, 0.01, "native chart reverses only the price multiplier");
});
test("contract lots use verified face quantity and underlying price", () => {
  const [t] = parseCvdTrades("okx", "perpetual",
    { arg: { channel: "trades", instId: "BTC-USDT-SWAP" },
      data: [{ tradeId: "1", ts: T, side: "buy", px: "100", sz: "20" }] },
    { symbol: "BTC-USDT-SWAP", contractSize: 0.01, priceDivisor: 1 });
  assert.equal(t.quantity, 0.2); assert.equal(t.price, 100); assert.equal(t.value, 20);
});
test("malformed, unknown-side and unpriced CVD summaries cannot fabricate bubbles", () => {
  const ledger = createAggressiveBubbleLedger({ market: "spot", now: () => T });
  for (const t of [trade({ price: undefined }), trade({ price: 0 }), trade({ value: NaN }),
    trade({ value: -1 }), trade({ side: "unknown" }), trade({ price: Number.MIN_VALUE, value: Number.MAX_VALUE })]) ledger.add(t);
  assert.equal(ledger.snapshot("1h", 0).points.length, 0);
  assert.equal(ledger.snapshot("1h", 0).first, null);
});
test("bubble retention and safety bounds trim old activity transparently", () => {
  let clock = T;
  const ledger = createAggressiveBubbleLedger({ market: "spot", now: () => clock, maxCells: 2 });
  ledger.add(trade()); ledger.add(trade({ price: 200 })); ledger.add(trade({ price: 300 }));
  assert.equal(ledger.snapshot("5m", 0).retainedCells, 2);
  assert.equal(ledger.snapshot("5m", 0).truncated, true);
  clock += 3 * 3600000;
  assert.equal(ledger.snapshot("5m", 0).points.length, 0);
});
test("API filter validation rejects invalid/array/prototype inputs", () => {
  assert.deepEqual(validateAggressiveBubblesQuery({ asset: "BTC" }), { asset: "BTC", timeframe: "1h", market: "both", minValue: 10000 });
  for (const q of [{ asset: ["BTC"] }, { asset: "../BTC" }, { asset: "BTC", market: "inverse" },
    { asset: "BTC", timeframe: "constructor" }, { asset: "BTC", minValue: [] },
    { asset: "BTC", minValue: "" }, { asset: "BTC", minValue: "Infinity" }, { asset: "BTC", minValue: -1 },
    { asset: "BTC", minValue: 1e13 }]) assert.throws(() => validateAggressiveBubblesQuery(q), e => e.status === 400);
});
test("bubbles reuse the CVD collectors/deduplication; market/filter changes do not create extra sockets", async () => {
  let clock = T, opened = 0;
  const callbacks = new Map();
  const service = createCvdIndicatorService({ now: () => clock, storageDir: null, timers: false,
    resolver: { resolve: async (exchange, market) => exchange === "binance" ? { exchange, market, symbol: "BTCUSDT" } : null },
    streams: { start: async (instrument, cb) => { opened++; callbacks.set(instrument.market, cb); return { stop() {} }; } } });
  service.get({ asset: "BTC", market: "perpetual", timeframe: "5m" });
  await service._groups.get("perpetual:BTC").ready;
  service.getBubbles({ asset: "BTC", market: "both", timeframe: "5m", minValue: 0 });
  await service._groups.get("spot:BTC").ready;
  callbacks.get("spot")(trade()); callbacks.get("spot")(trade());
  callbacks.get("perpetual")(trade({ side: "sell" }));
  clock += 3000;
  const b = service.getBubbles({ asset: "BTC", market: "both", timeframe: "5m", minValue: 0 });
  assert.equal(b.points.length, 2); assert.equal(b.sources.length, 20); assert.equal(opened, 2);
  assert.equal(b.points.find(p => p.market === "spot").value, 100);
  assert.equal(b.points.find(p => p.market === "perpetual").side, "sell");
  const spot = service.getBubbles({ asset: "BTC", market: "spot", timeframe: "1h", minValue: 200 });
  assert.equal(spot.points.length, 0); assert.equal(spot.sources.length, 10); assert.equal(opened, 2);
  assert.equal(service.get({ asset: "BTC", market: "spot", timeframe: "5m" }).candles[0].close, 100);
  await service.close();
});
