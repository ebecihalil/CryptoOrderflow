import test from "node:test";
import assert from "node:assert/strict";
import { buildOiDriverCandles, calculateOiDriver, driverSettings, liquidationSignificant } from "./oiDriverMath.js";
import { createOiDriverService } from "./oiDriverService.js";

test("the 0.5% liquidation threshold is inclusive and missing values never imply no liquidation", () => {
  assert.equal(liquidationSignificant(499_999, 100_000_000, 10), false);
  assert.equal(liquidationSignificant(500_000, 100_000_000, 10), true);
  assert.equal(liquidationSignificant(null, 100_000_000, 10), false);
  assert.equal(liquidationSignificant(900_000, 0, 10), false);
});

test("script parameter defaults remain intact and invalid values are rejected", () => {
  const settings = driverSettings();
  assert.equal(settings.spikeMult, 5);
  assert.equal(settings.maxSidewaysBars, 10);
  assert.equal(settings.pullback2, 20);
  assert.throws(() => driverSettings({ flatBodyPct: 101 }), /flatBodyPct/);
  assert.throws(() => driverSettings({ activityLength: 1.2 }), /activityLength/);
});

test("OI decreases distinguish a significant liquidation from a below-threshold exit", () => {
  const common = Array.from({ length: 20 }, (_, i) => ({
    time: i * 300, open: 100, high: 101, low: 98, close: 99, cohort: "venue:BTC",
    segmentStart: i === 0, sourceCount: 1, provisional: false, oiUsd: 100_000_000,
    cvd: { open: 0, high: 6, low: -1, close: 5, buyValue: 9, sellValue: 4 },
    longLiqUsd: 0, shortLiqUsd: 0, lsarDirection: 0,
    price: { open: 100, high: 102, low: 99, close: 101 },
  }));
  common[19].shortLiqUsd = 400_000;
  const below = calculateOiDriver(common).at(-1);
  assert.equal(below.state, "Short Exit");
  assert.equal(below.liquidationOiPct, 0.4);
  common[19].shortLiqUsd = 600_000;
  const above = calculateOiDriver(common).at(-1);
  assert.equal(above.state, "Short Liquidation");
  assert.equal(above.liquidationOiPct, 0.6);
  common[19].shortLiqUsd = null;
  assert.match(calculateOiDriver(common).at(-1).state, /coverage missing/);
});

test("aggregate OI candles require a matched previous cohort and break when venue membership changes", () => {
  const contracts = [
    { key: "binance:BTCUSDT", points: [
      { timestamp: 300_000, oiCoin: 10 }, { timestamp: 600_000, oiCoin: 11 }, { timestamp: 900_000, oiCoin: 12 },
    ] },
    { key: "bybit:BTCUSDT", points: [
      { timestamp: 300_000, oiCoin: 20 }, { timestamp: 600_000, oiCoin: 21 },
    ] },
  ];
  const candles = buildOiDriverCandles(contracts, 300_000, 1_200_000);
  assert.equal(candles.length, 2);
  assert.equal(candles[0].open, 30);
  assert.equal(candles[0].close, 32);
  assert.equal(candles[1].segmentStart, true);
  assert.equal(candles[1].open, 11);
  assert.equal(candles[1].close, 12);
});

test("driver service rejects unverified contracts and assembles only supplied exchange observations", () => {
  const now = Date.UTC(2026, 9, 16, 12, 0);
  const start = Math.floor(now / 3_600_000) * 3_600;
  const contract = { asset: "BTC", exchange: "bybit", symbol: "BTCUSDT" };
  let cvdAnchor;
  const service = createOiDriverService({
    now: () => now,
    catalogue: { get: () => ({ contracts: [contract], isRefreshing: false }) },
    oiInputs: () => ({ refreshing: false, sources: [{ exchange: "bybit", status: "ok" }],
      contracts: [{ asset: "BTC", exchange: "bybit", symbol: "BTCUSDT", key: "bybit:BTCUSDT", oiCoin: 10,
        oiUsd: 600_000, markPrice: 60_000, volume24hUsd: 1_200_000, priceDivisor: 1,
        points: [{ timestamp: (start - 300) * 1000, oiCoin: 9 }, { timestamp: start * 1000, oiCoin: 10 }] }] }),
    cvd: { get: ({ anchor }) => { cvdAnchor = anchor; return {
      candles: [{ time: start, open: 0, high: 1, low: -1, close: 1, buyValue: 8, sellValue: 7 }],
      sources: [], warnings: [], isLoading: false,
    }; },
      liquidationSnapshot: () => ({ events: [], coverage: [], sources: [] }) },
    lsar: () => [],
  });
  assert.throws(() => service.get({ asset: "BTC", timeframe: "1h", exchange: "binance", symbol: "BTCUSDT" }), /verified live catalogue/);
  const payload = service.get({ asset: "BTC", timeframe: "1h", exchange: "bybit", symbol: "BTCUSDT" });
  assert.equal(payload.asset, "BTC");
  assert.equal(payload.candles.length, 1);
  assert.equal(payload.candles[0].open, 9);
  assert.equal(payload.candles[0].close, 10);
  assert.equal(payload.totals.oiCoin, 10);
  assert.equal(payload.totals.average20dVolumeCoin, null);
  assert.equal(payload.sources.length, 10);
  assert.equal(cvdAnchor, "1d");
});
