import test from "node:test";
import assert from "node:assert/strict";
import { createSecondCandleRecorder } from "./secondCandles.js";
import { createSecondCandleService } from "./secondCandleService.js";

const T = 1_800_000_000_000;
const trade = (ms, price, quantity, extra = {}) => ({ exchange: "binance", symbol: "BTCUSDT", time: T + ms, price, quantity, ...extra });

test("seconds candles are exact OHLCV from executed trades and never precede recording", () => {
  let clock = T;
  const r = createSecondCandleRecorder({ now: () => clock });
  r.ingest(trade(100, 1, 1)); // not watched yet: ignored
  r.watch("binance", "BTCUSDT");
  r.ingest(trade(-500, 99, 1)); // before recording started: ignored
  r.ingest(trade(100, 100, 2)); r.ingest(trade(900, 103, 1)); r.ingest(trade(500, 98, 1)); // out-of-order arrival
  r.ingest(trade(1200, 101, 3)); r.ingest(trade(6100, 102, 1));
  clock = T + 7000;
  const one = r.candles("binance", "BTCUSDT", "1s").candles;
  assert.deepEqual(one.map(c => [c.time - T / 1000, c.open, c.high, c.low, c.close, c.volume]), [
    [0, 100, 103, 98, 103, 4], [1, 101, 101, 101, 101, 3], [6, 102, 102, 102, 102, 1]]);
  const five = r.candles("binance", "BTCUSDT", "5s").candles;
  assert.equal(five[0].time, T / 1000);
  assert.equal(five[0].volume, 7);
});

test("1000x contracts keep native price/volume units; idle contracts stop recording", () => {
  let clock = T;
  const r = createSecondCandleRecorder({ now: () => clock });
  r.watch("binance", "1000PEPEUSDT", 1000);
  r.ingest({ exchange: "binance", symbol: "1000PEPEUSDT", time: T + 10, price: 0.00001, quantity: 5000 });
  const bar = r.candles("binance", "1000PEPEUSDT", "1s").candles[0];
  assert.ok(Math.abs(bar.close - 0.01) < 1e-12); assert.equal(bar.volume, 5);
  clock += 11 * 60_000; r.prune();
  assert.equal(r.size(), 0);
});

test("seconds service explains when the live stream covers a different contract", async () => {
  const service = createSecondCandleService({
    recorder: createSecondCandleRecorder(),
    catalogue: { get: () => ({ contracts: [{ exchange: "binance", symbol: "BTCUSDT", asset: "BTC", priceDivisor: 1 }] }) },
    cvd: { get: () => ({ sources: [{ exchange: "binance", symbol: "BTCUSDC", status: "live" }] }) },
  });
  await assert.rejects(service.get({ exchange: "binance", symbol: "BTCUSDT", timeframe: "5s" }), /covers BTCUSDC/);
  await assert.rejects(service.get({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m" }), error => error.status === 400);
});
