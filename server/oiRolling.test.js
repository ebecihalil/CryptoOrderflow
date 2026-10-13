import test from "node:test";
import assert from "node:assert/strict";
import { rollingPair, candlePair, buildOiSnapshot, aggregateChange } from "./openInterestMath.js";
import { isCryptoAsset, isNonCryptoAsset } from "./cryptoAssets.js";
import { fetchOiHistoryWindow, mergeOiPoints } from "./openInterestHistory.js";
import { buildFundingSnapshot, fundingReading } from "./fundingMath.js";
import { createRows } from "./lsarMarketData.js";

const now = Date.UTC(2026, 9, 13, 14, 30), day = 86400_000;
const point = (timestamp, oiCoin) => ({ timestamp, oiCoin });
test("rolling 24h is not yesterday's closing candle comparison", () => {
    const points = [point(now - day, 100), point(Date.UTC(2026, 9, 12, 23, 55), 200), point(now, 120)];
    assert.ok(Math.abs(aggregateChange([rollingPair(points, now)]) - 20) < 1e-10);
    assert.equal(aggregateChange([candlePair(points, "24h", now)]), -40);
});
test("rolling baseline cannot be later than target or more than five minutes before it", () => {
    const latest = point(now - 100_000, 120), target = latest.timestamp - day;
    assert.equal(rollingPair([latest, point(target + 1, 100)], now), null);
    assert.equal(rollingPair([latest, point(target - 300_001, 100)], now), null);
    assert.deepEqual(rollingPair([latest, point(target - 300_000, 100)], now), { current: 120, previous: 100 });
});
test("rolling ignores future, null, zero-denominator and stale observations", () => {
    assert.equal(rollingPair([point(now + 1, 120), point(now - day, 100)], now), null);
    assert.equal(rollingPair([point(now, 120), point(now - day, 0)], now), null);
    assert.equal(rollingPair([point(now, null), point(now - day, 100)], now), null);
    assert.equal(rollingPair([point(now - 900_001, 120), point(now - 900_001 - day, 100)], now), null);
});
test("known equities, ETFs, commodities and tokenized-stock suffixes are excluded", () => {
    for (const asset of ["KORU", "SOXL", "SOXX", "KLAC", "USAR", "IBIT", "MSTR", "SAMSUNG", "SKHYNIX", "XAU", "NATGAS", "AAPLX", "NVDASTOCK", "xyz:TSLA", "1000MSTR"]) {
        assert.equal(isNonCryptoAsset(asset), true, asset);
        assert.equal(isCryptoAsset(asset), false, asset);
    }
    for (const asset of ["BTC", "1000PEPE", "1INCH", "BLUR"]) {
        assert.equal(isNonCryptoAsset(asset), false, asset); assert.equal(isCryptoAsset(asset), true, asset);
    }
    assert.equal(isCryptoAsset("UNVERIFIED_NEW_TICKER"), false);
});
test("rolling rankings only include verified crypto and report genuine matched coverage", () => {
    const readings = ["BTC", "ETH", "KORU", "SOXL", "UNVERIFIED_NEW_TICKER"].map(asset =>
        ({ exchange: "bybit", symbol: `${asset}USDT`, asset, exchangeAsset: asset, oiCoin: 120,
            oiUsd: 1200, markPrice: 10, fetchedAt: now, volume24hUsd: 2000 }));
    const states = { bybit: { readings, status: "live", running: false } };
    const histories = new Map(readings.filter(r => r.asset !== "ETH").map(r =>
        [`bybit:${r.symbol}`, [point(now - day, 100), point(now, 120)]]));
    const snapshot = buildOiSnapshot(states, histories, new Map(), "24h", now, [], { comparison: "rolling24h" });
    assert.deepEqual(snapshot.rows.map(r => r.asset), ["BTC", "ETH"]);
    assert.deepEqual(snapshot.extremes.gainers.map(r => r.asset), ["BTC"]);
    assert.deepEqual(snapshot.rankingCoverage, { eligibleCoins: 2, coinsWithHistory: 1, excludedNonCryptoOrUnverifiedCoins: 3 });
    assert.equal(buildOiSnapshot(states, histories, new Map(), "24h", now).rows.length, 5);
});
test("screen data is crypto-only; LSAR publishing and Funding reject unidentified symbols too", () => {
    const assets = ["BTC", "KORU", "SOXL", "TSLA", "1000MSTR", "UNVERIFIED_NEW_TICKER"];
    const funding = assets.map(asset => ({ ...fundingReading("bybit", `${asset}USDT`, asset, 100, 0.01, 8), fetchedAt: now }));
    const result = buildFundingSnapshot({ bybit: { readings: funding, status: "live", running: false } }, new Map(), "current", now);
    assert.deepEqual(result.rows.map(r => r.asset).sort(), ["BTC"]);
    const rows = createRows(assets.map(asset => ({ exchange: "bybit", symbol: `${asset}USDT`, asset, exchangeAsset: asset,
        fetchedAt: Date.now(), price: 1, openInterestUsd: 100, points: [{ timestamp: Date.now(), ratio: 1.1 }] }))
        .filter(reading => isCryptoAsset(reading.asset)));
    assert.deepEqual(rows.map(r => r.asset).sort(), ["BTC"]);
});
test("shared history merge retains 24h baselines from overlapping native and sampled streams", () => {
    const native = [], sampled = [];
    for (let i = 0; i < 360; ++i) { native.push(point(now - i * 300_000, 100)); sampled.push(point(now - i * 300_000 - 1000, 100)); }
    const merged = mergeOiPoints(native, [...sampled, point(now + 1, 1), point(now - 31 * 3600_000, 1), point(now, null)], now);
    assert.equal(merged.length, 720); assert.deepEqual(rollingPair(merged, now), { current: 100, previous: 100 });
    assert.equal(mergeOiPoints([], [point(now, 1), point(now, 2)], now).length, 1);
});
test("Binance full backfill requests one shared 30h window and scales multiplier coin quantities", async () => {
    let calls = 0;
    const points = await fetchOiHistoryWindow(async url => {
        ++calls; const q = new URL(url).searchParams;
        assert.equal(q.get("limit"), "500"); assert.equal(q.get("period"), "5m");
        assert.equal(Number(q.get("startTime")), now - 30 * 3600_000);
        return [{ timestamp: now - day, sumOpenInterest: "100" }, { timestamp: now, sumOpenInterest: "120" }];
    }, { exchange: "binance", symbol: "1000PEPEUSDT", exchangeAsset: "1000PEPE" }, now);
    assert.equal(calls, 1); assert.deepEqual(points.map(p => p.oiCoin), [100_000, 120_000]);
});
test("Bybit full backfill uses bounded chunks and the same single-sided quantity basis", async () => {
    let calls = 0;
    const result = await fetchOiHistoryWindow(async url => {
        ++calls; const q = new URL(url).searchParams;
        assert.equal(q.get("limit"), "200");
        return { result: { list: [{ timestamp: q.get("startTime"), openInterest: "200", singleOpenInterest: "100" }] } };
    }, { exchange: "bybit", symbol: "BTCUSDT", exchangeAsset: "BTC" }, now);
    assert.equal(calls, 2); assert.ok(result.every(p => p.oiCoin === 100));
});
test("Gate full backfill uses documented start/limit chunks, converts quantities and deduplicates", async () => {
    let calls = 0;
    const result = await fetchOiHistoryWindow(async url => {
        ++calls; const q = new URL(url).searchParams; assert.equal(q.get("limit"), "100"); assert.equal(q.has("to"), false);
        return [{ time: Number(q.get("from")), open_interest: 20000 }];
    }, { exchange: "gate", symbol: "BTC_USDT", exchangeAsset: "BTC", contractSizeCoin: 0.01 }, now);
    assert.equal(calls, 5); assert.ok(result.every(p => p.oiCoin === 100));
});
