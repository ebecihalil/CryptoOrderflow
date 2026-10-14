import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createChartWatchlist } from "./chartWatchlist.js";
import { createCvdIndicatorService } from "./cvdIndicator.js";
import { createAggressiveBubbleLedger } from "./aggressiveBubbles.js";

const T = Date.UTC(2026, 9, 15);
const contract = (asset, exchange = "binance") => ({ asset, exchange, symbol: `${asset}USDT`,
  label: `${asset}USDT — ${exchange}`, priceDivisor: 1, tvExchange: exchange.toUpperCase(),
  ticker: `${asset}USDT`, exchangeAsset: asset });

test("five unique watched assets, duplicate venue updates and durable restart restoration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "watchlist-"));
  const assets = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA"];
  const contracts = [...assets.map(a => contract(a)), contract("BTC", "bybit")];
  const pins = new Set(), removed = [];
  const recorder = { storageDir: dir, pinAsset: a => pins.add(a), unpinAsset: a => { pins.delete(a); removed.push(a); },
    recordingStatus: () => ({ status: "starting", liveSources: 0, totalSources: 20, historyStart: null, historyEnd: null }) };
  const opts = { recorder, catalogue: { get: () => ({ contracts }) }, now: () => T };
  const a = createChartWatchlist(opts);
  try {
    for (const asset of assets.slice(0, 5)) await a.add({ exchange: "binance", symbol: `${asset}USDT` });
    assert.equal((await a.get()).items.length, 5);
    await assert.rejects(a.add({ exchange: "binance", symbol: "ADAUSDT" }), /full/);
    await a.add({ exchange: "bybit", symbol: "BTCUSDT" });
    assert.equal((await a.get()).items[0].contract.exchange, "bybit");
    assert.equal(pins.size, 5);
    await a.remove("ADA"); assert.equal(removed.length, 0);
    await a.remove("DOGE"); await a.add({ exchange: "binance", symbol: "ADAUSDT" });
    await a.close(); pins.clear();
    const b = createChartWatchlist(opts); await b.ready;
    assert.equal((await b.get()).items.length, 5);
    assert.equal(pins.size, 5);
    assert.equal((await b.get()).items[0].contract.exchange, "bybit");
    await b.close();
  } finally { await a.close(); await rm(dir, { recursive: true, force: true }); }
});

test("background pins reserve ten cohorts, share viewed feeds and survive idle eviction", async () => {
  let clock = T, opened = 0;
  const callbacks = new Map();
  const service = createCvdIndicatorService({ now: () => clock, storageDir: null, timers: false,
    resolver: { resolve: async (exchange, market, asset) => exchange === "binance" ? { exchange, market, asset, symbol: `${asset}USDT` } : null },
    streams: { start: async (i, trade) => { opened++; callbacks.set(`${i.market}:${i.asset}`, trade); return { stop() {} }; } },
  });
  try {
    for (const a of ["BTC", "ETH", "SOL", "XRP", "DOGE"]) service.pinAsset(a);
    await Promise.all([...service._groups.values()].map(g => g.ready));
    assert.equal(service._groups.size, 10); assert.equal(opened, 10);
    service.getBubbles({ asset: "BTC", market: "both" }); assert.equal(opened, 10);
    assert.throws(() => service.pinAsset("ADA"), /five/);
    clock += 31 * 60000;
    service.get({ asset: "ADA", market: "spot" });
    assert.ok([...service._groups.values()].filter(g => g.asset !== "ADA").every(g => g.active));
    callbacks.get("spot:BTC")({ id: "new", exchange: "binance", symbol: "BTCUSDT", time: clock, side: "buy", price: 10, value: 100 });
    clock += 3000;
    const payload = service.getBubbles({ asset: "BTC", market: "spot", minValue: 0 });
    assert.equal(payload.points[0].value, 100);
    service.unpinAsset("ETH"); assert.equal(service._groups.get("spot:ETH").active, false);
    service.pinAsset("ADA");
  } finally { await service.close(); }
});

test("price-level recordings restore across a service restart without recreating CVD prices", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bubble-restore-"));
  let clock = T, handler;
  const opts = { storageDir: dir, now: () => clock, timers: false,
    resolver: { resolve: async (exchange, market, asset) => exchange === "binance" ? { exchange, market, asset, symbol: `${asset}USDT` } : null },
    streams: { start: async (_i, cb) => { handler = cb; return { stop() {} }; } },
  };
  const a = createCvdIndicatorService(opts);
  try {
    a.get({ asset: "BTC", market: "spot" }); await a._groups.get("spot:BTC").ready;
    handler({ id: "1", exchange: "binance", symbol: "BTCUSDT", time: clock, side: "buy", price: 100, value: 25000 });
    clock += 3000; const before = a.getBubbles({ asset: "BTC", market: "spot" }).points;
    await a.close(); clock += 3 * 86400000;
    const b = createCvdIndicatorService(opts);
    try {
      b.get({ asset: "BTC", market: "spot" }); await b._groups.get("spot:BTC").ready;
      const after = b.getBubbles({ asset: "BTC", market: "spot" }).points;
      assert.deepEqual(after, before);
      assert.ok(b.get({ asset: "BTC", market: "spot" }).warnings.some(w => /downtime|disconnected/.test(w)));
    } finally { await b.close(); }
  } finally { await a.close(); await rm(dir, { recursive: true, force: true }); }
});

test("bubble archive validation is transactional and enforces seven-day retention", () => {
  let clock = T;
  const ledger = createAggressiveBubbleLedger({ market: "spot", now: () => clock, retentionSeconds: 7 * 86400 });
  ledger.add({ time: T, side: "sell", exchange: "binance", price: 10, value: 50 });
  const body = ledger.serialize();
  assert.throws(() => ledger.restore({ ...body, cells: [{ ...body.cells[0], quantity: -1 }] }), /Invalid/);
  assert.equal(ledger.snapshot("1h", 0).points[0].value, 50);
  clock += 8 * 86400000;
  ledger.restore(body, ["binance"]);
  assert.equal(ledger.snapshot("1h", 0).points.length, 0);
});

test("five-minute archive compaction preserves every supported chart aggregation", () => {
  const now = () => T + 180000;
  const old = createAggressiveBubbleLedger({ market: "spot", now, retentionSeconds: 604800 });
  old.add({ time: T, side: "buy", exchange: "binance", price: 100, value: 20 });
  old.add({ time: T + 60000, side: "buy", exchange: "bybit", price: 100, value: 40 });
  const compact = createAggressiveBubbleLedger({ market: "spot", now, retentionSeconds: 604800, bucketSeconds: 300 });
  compact.restore(old.serialize(), ["binance", "bybit"]);
  assert.equal(compact.info().retainedCells, 1);
  for (const tf of ["5m", "15m", "30m", "1h", "4h", "24h"]) assert.deepEqual(compact.snapshot(tf, 0).points, old.snapshot(tf, 0).points);
  const restored = createAggressiveBubbleLedger({ market: "spot", now, bucketSeconds: 300 });
  restored.restore(compact.serialize(), ["binance", "bybit"]);
  assert.deepEqual(restored.snapshot("5m", 0).points, compact.snapshot("5m", 0).points);
});

test("watchlist rejects invented contracts and never reports successful saving with no storage", async () => {
  let pins = 0, unpins = 0;
  const a = createChartWatchlist({ storageDir: null,
    recorder: { pinAsset() { pins++; }, unpinAsset() { unpins++; }, recordingStatus() { return {}; } },
    catalogue: { get: () => ({ contracts: [contract("BTC")] }) } });
  await assert.rejects(a.add({ exchange: "binance", symbol: "MADEUPUSDT" }), /not currently available/);
  await assert.rejects(a.add({ exchange: "__proto__", symbol: "BTCUSDT" }), /valid perpetual/);
  await assert.rejects(a.add({ exchange: "binance", symbol: "BTCUSDT" }), /recording directory/);
  assert.equal((await a.get()).items.length, 0);
  assert.equal(pins, 1); assert.equal(unpins, 1);
  await a.close();
});
