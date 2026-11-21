import test from "node:test";
import assert from "node:assert/strict";
import { calculateMarketDriver, MARKET_DRIVER_COLORS as C } from "../src/lib/market-driver.js";
import { createMarketDriverService } from "./marketDriverService.js";

// Calm history so moving averages exist, then the bar under test.
const calm = (n, oi = 1000) => Array.from({ length: n }, (_, i) => ({ time: i * 3600,
  price: { open: 100, high: 101, low: 99, close: 100.6 }, oi: { high: oi + 2, low: oi, close: oi + (i % 2 ? 1 : 2) },
  cvd: { open: 0, high: 60, low: -5, close: 50, buy: 1000, sell: 900 }, liqLongUsd: 0, liqShortUsd: 0, lsr: 1 }));
const last = result => result.bars.at(-1);

test("OI up + CVD up + price up = Aggressive Longs Openings (blue); ratio adds the retail/whale note and signals", () => {
  const bars = calm(25);
  bars.push({ time: 25 * 3600, price: { open: 100, high: 104, low: 99.8, close: 103.8 }, oi: { high: 1050, low: 1002, close: 1050 },
    cvd: { open: 0, high: 900, low: 0, close: 900, buy: 5000, sell: 1000 }, liqLongUsd: 0, liqShortUsd: 0, lsr: 0.9 });
  const bar = last(calculateMarketDriver(bars));
  assert.equal(bar.state, "Aggressive Longs Openings");
  assert.equal(bar.color, C.longBuild);
  assert.equal(bar.driverBottom, "Whale accumulation", "top-trader ratio falling");
  assert.equal(bar.bullId, 1);
  assert.equal(bar.bodyColor, C.longBuild, "volume above its average keeps the colour");
  assert.equal(Math.round(bar.buyPct), 83);
});

test("OI down + CVD down + price down with large long liquidations = Long Liquidation (purple)", () => {
  const bars = calm(25);
  bars.push({ time: 25 * 3600, price: { open: 100, high: 100.2, low: 95, close: 95.2 }, oi: { high: 1001, low: 960, close: 960 },
    cvd: { open: 0, high: 0, low: -900, close: -900, buy: 500, sell: 6000 }, liqLongUsd: 500_000, liqShortUsd: 0, lsr: 1.2 });
  const bar = last(calculateMarketDriver(bars));
  assert.equal(bar.state, "Long Liquidation");
  assert.equal(bar.color, C.longExitLiq);
  assert.equal(bar.driverBottom, "Retail Longs build the dip");
  assert.equal(bar.bearId, 13);
});

test("below-average aggressive volume gives a grey body; state colours can be switched off", () => {
  const bars = calm(25);
  bars.push({ ...bars.at(-1), time: 25 * 3600, cvd: { open: 0, high: 60, low: -5, close: 50, buy: 10, sell: 10 } });
  assert.equal(last(calculateMarketDriver(bars)).bodyColor, C.lowVolume);
  const plain = last(calculateMarketDriver(bars, { stateColors: false }));
  assert.ok([C.up, C.down].includes(plain.color));
});

test("a single OI jump far above the average body starts a whale spike label with its % growth", () => {
  const bars = calm(60);
  bars.push({ time: 60 * 3600, price: { open: 100, high: 103, low: 99.8, close: 102.8 }, oi: { high: 1300, low: 1001, close: 1300 },
    cvd: { open: 0, high: 900, low: 0, close: 900, buy: 5000, sell: 1000 }, liqLongUsd: 0, liqShortUsd: 0, lsr: 1 });
  const { labels } = calculateMarketDriver(bars);
  assert.equal(labels.length, 1);
  assert.equal(labels[0].time, 60 * 3600);
  assert.match(labels[0].text, /^2\d\.\d\d%$/);
});

test("service: one row per chart candle with OI, CVD, liquidations and the top-trader ratio as of the candle", async () => {
  const service = createMarketDriverService({
    candles: { get: async () => ({ candles: [{ time: 3600, open: 1, high: 2, low: 0.5, close: 1.5 }, { time: 7200, open: 1.5, high: 2, low: 1, close: 1.8 }] }) },
    aggregatedOi: { get: async () => ({ candles: [{ time: 3600, open: 9, high: 11, low: 9, close: 10 }], current: { oiCoin: 12 } }) },
    cvd: {
      get: ({ timeframe }) => timeframe === "24h" ? { candles: [{ buyValue: 10, sellValue: 10 }, { buyValue: 30, sellValue: 10 }] }
        : { candles: [{ time: 7200, open: 0, high: 5, low: -1, close: 4, buyValue: 6, sellValue: 2 }] },
      liquidationSnapshot: () => ({ events: [{ time: 7_300_000, side: "long", usd: 50 }] }),
    },
    lsar: () => ({ points: [{ time: 3600, ratio: 1.1 }, { time: 7500, ratio: 1.3 }] }),
  });
  const result = await service.get({ asset: "BTC", timeframe: "1h", exchange: "binance", symbol: "BTCUSDT" });
  assert.equal(result.bars.length, 2);
  assert.deepEqual(result.bars[0].oi, { high: 11, low: 9, close: 10 });
  assert.equal(result.bars[1].cvd.buy, 6);
  assert.equal(result.bars[1].liqLongUsd, 50);
  assert.equal(result.bars[0].lsr, 1.1);
  assert.equal(result.bars[1].lsr, 1.3);
  assert.equal(result.totals.oiUsd, 12 * 1.8);
  assert.equal(result.totals.dailyVolumeUsd, 40);
  assert.equal(result.totals.average20dVolumeUsd, 20);
});
