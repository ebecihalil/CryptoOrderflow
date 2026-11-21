import test from "node:test";
import assert from "node:assert/strict";
import { createLiquidationService } from "./liquidationService.js";

test("long/short liquidations per candle with the feed exchanges' OI in USD; uncovered candles are gaps", async () => {
  const H = 3600;
  const service = createLiquidationService({
    candles: { get: async () => ({ candles: [0, 1, 2].map(i => ({ time: i * H, open: 10, high: 11, low: 9, close: 10 })) }) },
    cvd: {
      get() {},
      liquidationSnapshot: () => ({
        events: [{ time: H * 1000 + 5_000, side: "long", usd: 500 }, { time: H * 1000 + 9_000, side: "short", usd: 200 },
          { time: 2 * H * 1000 + 1_000, side: "long", usd: 100 }],
        spans: { binance: [[H * 1000, 3 * H * 1000]] },
      }),
    },
    oiInputs: () => ({ contracts: [{ oiCoin: 1000 }],
      long: { binance: [{ timestamp: H * 1000, oiCoin: 600 }, { timestamp: 2 * H * 1000, oiCoin: 700 }],
        okx: [{ timestamp: H * 1000, oiCoin: 400 }] } }),
  });
  const { bars } = await service.get({ asset: "BTC", timeframe: "1h", exchange: "binance", symbol: "BTCUSDT" });
  assert.deepEqual(bars[0], { time: 0, longUsd: null, shortUsd: null, oiUsd: null }, "feed not connected yet: gap, not zero");
  assert.equal(bars[1].longUsd, 500);
  assert.equal(bars[1].shortUsd, 200);
  assert.equal(bars[1].oiUsd, 1000 * 10, "binance 600 + okx 400 coins × price");
  assert.equal(bars[2].longUsd, 100);
  assert.equal(bars[2].shortUsd, 0, "covered candle without shorts is a real zero");
});
