import test from "node:test";
import assert from "node:assert/strict";
import { compactCvdMinutes, newCvdMinute, addCvdTrade, buildCvdCandles } from "./cvdMath.js";
import { createAggressiveBubbleLedger } from "./aggressiveBubbles.js";
import { createOiLongHistory, exchangeSteps } from "./oiLongHistory.js";
import { thinObservations } from "./fundingIndicator.js";

test("CVD: minutes older than the detail window become exact 5-minute steps", () => {
  const minutes = new Map();
  const add = (time, value) => { const row = minutes.get(time) ?? newCvdMinute(time); addCvdTrade(row, { side: value > 0 ? "buy" : "sell", value: Math.abs(value), exchange: "binance" }); minutes.set(time, row); };
  for (let i = 0; i < 20; i++) add(i * 60, i % 3 === 0 ? -5 : 10);
  const before = buildCvdCandles([...minutes.values()], "15m", "1y", 10_000).map(c => [c.time, c.close, c.high, c.low]);
  compactCvdMinutes(minutes, 10 * 60); // first 10 minutes → two 5-minute steps
  assert.equal([...minutes.keys()].filter(t => t < 600).length, 2);
  const after = buildCvdCandles([...minutes.values()], "15m", "1y", 10_000).map(c => [c.time, c.close, c.high, c.low]);
  assert.deepEqual(after, before, "15m candles are identical after compaction");
  assert.equal(compactCvdMinutes(minutes, 10 * 60), 0, "running again changes nothing");
});

test("bubbles: cells older than 7 days move to hourly cells with wider price steps, total volume kept", () => {
  let clock = 1_700_000_000_000;
  const ledger = createAggressiveBubbleLedger({ market: "perpetual", now: () => clock, retentionSeconds: 30 * 86400,
    maxCells: 10_000, bucketSeconds: 300, archiveAfterSeconds: 7 * 86400 });
  for (let i = 0; i < 12; i++) ledger.add({ side: "buy", price: 100 + i * 0.01, value: 1000, time: clock + i * 300_000, exchange: "binance" });
  const total = () => ledger.snapshot("24h", 0).points.reduce((sum, p) => sum + p.value, 0);
  assert.equal(total(), 12_000);
  clock += 8 * 86400_000;
  ledger.snapshot("24h", 0);
  assert.equal(total(), 12_000);
  assert.ok(ledger.info().retainedCells <= 2, "merged into hourly cells");
  // Survives save/restore.
  const restored = createAggressiveBubbleLedger({ market: "perpetual", now: () => clock, retentionSeconds: 30 * 86400,
    maxCells: 10_000, bucketSeconds: 300, archiveAfterSeconds: 7 * 86400 });
  restored.restore(ledger.serialize());
  assert.equal(restored.snapshot("24h", 0).points.reduce((sum, p) => sum + p.value, 0), 12_000);
  clock += 31 * 86400_000;
  assert.equal(ledger.snapshot("24h", 0).points.length, 0, "dropped after 30 days");
});

test("open interest: 5-minute exchange totals only when every contract has a fresh sample", () => {
  const contracts = [
    { exchange: "binance", points: [{ timestamp: 0, oiCoin: 10 }, { timestamp: 600_000, oiCoin: 12 }] },
    { exchange: "binance", points: [{ timestamp: 0, oiCoin: 5 }] },
    { exchange: "okx", points: [{ timestamp: 1_200_000, oiCoin: 7 }] },
  ];
  const steps = exchangeSteps(contracts, 0, 1_200_000);
  assert.deepEqual(steps.binance.map(p => [p.timestamp, p.oiCoin]), [[0, 15], [300_000, 15], [600_000, 17], [900_000, 17]]);
  assert.deepEqual(steps.okx.map(p => p.timestamp), [1_200_000]);
  let clock = 2_000_000;
  const history = createOiLongHistory({ directory: null, now: () => clock, always: ["BTC"] });
  history.record("BTC", contracts);
  assert.ok(history.series("BTC").binance.length >= 4);
  history.track("ETH");
  assert.deepEqual(history.tracked().sort(), ["BTC", "ETH"]);
  clock += 3 * 3600_000;
  assert.deepEqual(history.tracked(), ["BTC"], "viewed coins stop after 2 hours; top coins stay");
});

test("funding live quotes: minute detail for 7 days, hourly after, 120 days in total", () => {
  const now = 200 * 86400;
  const points = [];
  for (let t = now - 130 * 86400; t <= now; t += 600) points.push({ time: t });
  const thinned = thinObservations(points, now);
  assert.ok(thinned[0].time >= now - 120 * 86400);
  assert.equal(thinned.filter(p => p.time >= now - 7 * 86400).length, points.filter(p => p.time >= now - 7 * 86400).length);
  assert.ok(thinned.filter(p => p.time < now - 7 * 86400).length <= 113 * 24 + 1);
});
