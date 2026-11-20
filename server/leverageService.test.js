import test from "node:test";
import assert from "node:assert/strict";
import { fetchBinanceLeverage, fetchOkxLeverage, fetchGateLeverage, fetchBybitLeverage, spotSymbolFor } from "./leverageSources.js";
import { createLeverageService, pickContract } from "./leverageService.js";

const H = 3_600_000, T = 1_800_000_000_000 - (1_800_000_000_000 % H);

test("Binance adapter values 1000x taker volume at the OI-implied contract price", async () => {
  const urls = [];
  const request = async url => {
    urls.push(url);
    const path = new URL(url).pathname;
    if (path.endsWith("/openInterestHist")) return [{ timestamp: T, sumOpenInterest: "1000", sumOpenInterestValue: "20" }];
    if (path.endsWith("/topLongShortAccountRatio")) return [{ timestamp: T, longShortRatio: "1.5" }];
    if (path.endsWith("/topLongShortPositionRatio")) return [{ timestamp: T, longShortRatio: "2" }];
    if (path.endsWith("/globalLongShortAccountRatio")) return [{ timestamp: T, longShortRatio: "3" }];
    if (path.endsWith("/takerlongshortRatio")) return [{ timestamp: T, buyVol: "300", sellVol: "100" }];
    if (path.endsWith("/klines")) return [[T, "1", "1", "1", "1", "5", T + H - 1, "7.5"]];
    throw new Error(url);
  };
  const { bars, errors } = await fetchBinanceLeverage({ symbol: "1000PEPEUSDT", spotSymbol: "PEPEUSDT", timeframe: "1h", request });
  assert.deepEqual(errors, []);
  assert.deepEqual(bars, [{ time: T, oiUsd: 20, price: 0.02, topAccountRatio: 1.5, topPositionRatio: 2,
    globalAccountRatio: 3, takerBuyUsd: 6, takerSellUsd: 2, spotTurnoverUsd: 7.5 }]);
  assert.ok(urls.every(url => !url.includes("period=") || url.includes("period=1h")));
  assert.ok(urls.some(url => url.startsWith("https://api.binance.com/api/v3/klines?symbol=PEPEUSDT")));
});

test("OKX, Gate and Bybit adapters map their native fields and keep missing values absent", async () => {
  const okx = await fetchOkxLeverage({ symbol: "BTC-USDT-SWAP", spotSymbol: "BTC-USDT", timeframe: "4h", request: async url => {
    assert.match(url, /period=4H|bar=4H/);
    if (url.includes("open-interest-history")) return { code: "0", data: [[String(T), "10", "2", "200000"]] };
    if (url.includes("position-ratio-contract-top-trader")) return { code: "0", data: [[String(T), "1.2"]] };
    if (url.includes("account-ratio-contract-top-trader")) return { code: "0", data: [[String(T), "0.8"]] };
    if (url.includes("long-short-account-ratio-contract")) return { code: "0", data: [[String(T), "1.1"]] };
    if (url.includes("taker-volume-contract")) return { code: "0", data: [[String(T), "40", "60"]] };
    if (url.includes("market/candles")) return { code: "0", data: [[String(T), "1", "1", "1", "1", "1", "1", "900", "1"]] };
    throw new Error(url);
  } });
  assert.deepEqual(okx.bars[0], { time: T, oiUsd: 200000, price: 100000, topAccountRatio: 0.8, topPositionRatio: 1.2,
    globalAccountRatio: 1.1, takerBuyUsd: 60, takerSellUsd: 40, spotTurnoverUsd: 900 });

  const gate = await fetchGateLeverage({ symbol: "BTC_USDT", spotSymbol: "BTC_USDT", timeframe: "1h", request: async url =>
    url.includes("contract_stats")
      ? [{ time: T / 1000, open_interest_usd: 500, mark_price: 10, top_lsr_account: 1.3, top_lsr_size: 0.9, lsr_account: 2, long_liq_usd: 5, short_liq_usd: 0 }]
      : [[String(T / 1000), "50", "1", "1", "1", "1", "5", "true"]] });
  assert.deepEqual(gate.bars[0], { time: T, oiUsd: 500, price: 10, topAccountRatio: 1.3, topPositionRatio: 0.9,
    globalAccountRatio: 2, longLiqUsd: 5, shortLiqUsd: 0, spotTurnoverUsd: 50 });

  const bybit = await fetchBybitLeverage({ symbol: "BTCUSDT", spotSymbol: "BTCUSDT", timeframe: "1h", request: async url => {
    if (url.includes("open-interest")) return { retCode: 0, result: { list: [{ openInterest: "3", timestamp: String(T) }] } };
    if (url.includes("account-ratio")) return { retCode: 0, result: { list: [{ buyRatio: "0.6", sellRatio: "0.4", timestamp: String(T) }] } };
    if (url.includes("category=linear")) return { retCode: 0, result: { list: [[String(T - H), "1", "1", "1", "100", "1", "1"]] } };
    return { retCode: 0, result: { list: [[String(T), "1", "1", "1", "1", "1", "42"]] } };
  } });
  // Boundary snapshot valued at the close of the bar that ended there.
  assert.equal(bybit.bars.find(bar => bar.time === T).oiUsd, 300);
  assert.ok(Math.abs(bybit.bars.find(bar => bar.time === T).globalAccountRatio - 1.5) < 1e-12);
  assert.equal(spotSymbolFor("okx", "ETH"), "ETH-USDT");
});

test("service picks plain contracts, reports per-source status and never blocks the request", async () => {
  const contracts = [
    { exchange: "binance", asset: "BTC", exchangeAsset: "BTC", symbol: "BTCUSDT" },
    { exchange: "gate", asset: "BTC", exchangeAsset: "BTC", symbol: "BTC_USDT" },
  ];
  assert.equal(pickContract([{ exchange: "binance", asset: "PEPE", exchangeAsset: "1000PEPE", symbol: "1000PEPEUSDT" }], "binance", "PEPE").symbol, "1000PEPEUSDT");
  const bars = Array.from({ length: 80 }, (_, i) => ({ time: T + i * H, oiUsd: 1000 + i, spotTurnoverUsd: 100,
    topAccountRatio: 1, topPositionRatio: 1.2, takerBuyUsd: 60, takerSellUsd: 40 }));
  let clock = T;
  const service = createLeverageService({
    now: () => clock,
    catalogue: { get: () => ({ contracts }) },
    fetchers: {
      binance: async () => ({ bars, errors: [] }),
      gate: async () => { throw new Error("Binance HTTP 451: restricted region"); },
      okx: async () => ({ bars: [], errors: [] }), bybit: async () => ({ bars: [], errors: [] }),
    },
  });
  const first = service.get({ asset: "btc", timeframe: "1h" });
  assert.equal(first.rows.length, 0);
  assert.equal(first.isRefreshing, true);
  await service.refresh("BTC", "1h");
  const second = service.get({ asset: "BTC", timeframe: "1h" });
  assert.equal(second.rows.length, 80);
  assert.equal(second.sources.find(s => s.exchange === "binance").status, "live");
  assert.equal(second.sources.find(s => s.exchange === "okx").status, "not listed");
  assert.equal(second.sources.find(s => s.exchange === "gate").status, "unavailable");
  assert.ok(second.latest.leverageScore === null || second.latest.leverageScore >= 0);
  assert.equal(second.latest.buildState, "long-build");
  assert.throws(() => service.get({ asset: "BTC", timeframe: "2h" }), /timeframe/);
  assert.throws(() => service.get({ asset: "AAPL" }), error => error.status === 400);
});
