import test from "node:test";
import assert from "node:assert/strict";
import { buildAggregatedOiCandles, createAggregatedOiService, nativeInterval, fetchContractOiHistory } from "./aggregatedOi.js";

const H = 3600_000, D = 86_400_000;

test("candles sit on the chart's own buckets and the newest candle is the live total of ALL exchanges", () => {
  // History only for contract a; b has no history (only its live value) but counts in the total.
  const now = 20 * D + 5 * H;
  const series = [{ key: "a", points: Array.from({ length: 20 * 24 }, (_, i) => ({ timestamp: i * H, oiCoin: 1000 + i })) }];
  const candles = buildAggregatedOiCandles(series, "24h", now, 1000 + 479 + 5000);
  assert.equal(candles.at(-1).time, 20 * 86400, "today's candle is present");
  assert.equal(Math.round(candles.at(-1).close), 6479, "anchored to the real total");
  for (let i = 1; i < candles.length; i++) assert.equal(candles[i].open, candles[i - 1].close, "chained, no gaps");
  // Weekly candles start on Monday like the chart.
  const weekly = buildAggregatedOiCandles(series, "1w", now, 6479);
  assert.ok(weekly.every(bar => new Date(bar.time * 1000).getUTCDay() === 1));
});

test("a venue joining mid-history never creates a fake jump", () => {
  const now = 10 * H;
  const series = [
    { key: "a", points: Array.from({ length: 10 }, (_, i) => ({ timestamp: i * H, oiCoin: 100 })) },
    { key: "b", points: Array.from({ length: 5 }, (_, i) => ({ timestamp: (5 + i) * H, oiCoin: 900 })) },
  ];
  const candles = buildAggregatedOiCandles(series, "1h", now, 1000);
  const moves = candles.map(bar => bar.close / bar.open);
  assert.ok(moves.every(ratio => Math.abs(ratio - 1) < 1e-9), JSON.stringify(moves));
  assert.equal(Math.round(candles.at(-1).close), 1000);
});

test("small timeframes show flat steps between 5-minute samples instead of dropping candles", () => {
  const now = 3 * H;
  const series = [{ key: "a", points: Array.from({ length: 36 }, (_, i) => ({ timestamp: i * 300_000, oiCoin: 100 + i })) }];
  const candles = buildAggregatedOiCandles(series, "1m", now, 135);
  assert.ok(candles.length > 150);
  assert.equal(candles.at(-1).time, Math.floor(now / 60_000) * 60);
  assert.ok(candles.some(bar => bar.filled));
});

test("native history intervals and exchange parsing (single-sided coins)", async () => {
  assert.equal(nativeInterval("1m"), 300_000);
  assert.equal(nativeInterval("4h"), 14_400_000);
  assert.equal(nativeInterval("1w"), 86_400_000);
  const responses = {
    "fapi.binance.com": [{ timestamp: 1000, sumOpenInterest: "10" }],
    "api.bybit.com": { result: { list: [{ timestamp: "1000", openInterest: "20" }], nextPageCursor: "" } },
    "www.okx.com": { code: "0", data: [["1000", "5", "30", "999"]] },
    "api.gateio.ws": [{ time: 1, open_interest: 400 }],
  };
  const request = async url => responses[new URL(url).host];
  const item = (exchange, extra = {}) => ({ exchange, symbol: "BTCUSDT", asset: "BTC", exchangeAsset: "BTC", ...extra });
  assert.deepEqual(await fetchContractOiHistory(request, item("binance"), 3_600_000, 5000), [{ timestamp: 1000, oiCoin: 10 }]);
  assert.deepEqual(await fetchContractOiHistory(request, item("bybit"), 3_600_000, 5000), [{ timestamp: 1000, oiCoin: 10 }]);
  assert.deepEqual(await fetchContractOiHistory(request, item("okx"), 3_600_000, 5000), [{ timestamp: 1000, oiCoin: 30 }]);
  assert.deepEqual(await fetchContractOiHistory(request, item("gate", { contractSizeCoin: 0.001 }), 3_600_000, 5000), [{ timestamp: 1000, oiCoin: 0.2 }]);
});

test("service: every exchange counts in the total, history fetched only where exchanges publish it", async () => {
  const now = 10 * D;
  const calls = [];
  const contracts = [
    { exchange: "binance", symbol: "XUSDT", asset: "BTC", exchangeAsset: "BTC", oiCoin: 100, oiUsd: 1000, fetchedAt: now - 1000, points: [] },
    { exchange: "hyperliquid", symbol: "BTC", asset: "BTC", exchangeAsset: "BTC", oiCoin: 50, oiUsd: 500, fetchedAt: now - 1000,
      points: Array.from({ length: 48 }, (_, i) => ({ timestamp: now - (48 - i) * H, oiCoin: 50 })) },
  ];
  const service = createAggregatedOiService({ now: () => now,
    inputs: () => ({ contracts }),
    request: async url => { calls.push(url); return Array.from({ length: 48 }, (_, i) => ({ timestamp: now - (48 - i) * H, sumOpenInterest: "100" })); } });
  const result = await service.get({ asset: "BTC", timeframe: "1h" });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /fapi\.binance\.com/);
  assert.equal(result.current.oiCoin, 150);
  assert.equal(Math.round(result.candles.at(-1).close), 150);
  assert.deepEqual(result.exchanges.map(item => item.exchange), ["binance", "hyperliquid"]);
});
