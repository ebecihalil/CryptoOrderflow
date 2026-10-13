import test from "node:test";
import assert from "node:assert/strict";
import { buildToobitReading, buildChange, createRows, fetchToobit, countFetchedReadings } from "./lsarMarketData.js";
import { MARKET_EXCHANGES, EXCHANGE_LABELS, matchesExchangeFilter } from "../src/lib/exchange-options.ts";

const period = 5 * 60_000;
const now = Math.floor(Date.now() / period) * period;
const contract = { symbol: "1000X-SWAP-USDT", quoteAsset: "USDT", status: "TRADING", inverse: false, contractMultiplier: "0.001" };
const ticker = { s: contract.symbol, c: "20", pcp: "-0.05", qv: "100000" };
const interest = { openInterestList: [{ symbol: contract.symbol, size: "50" }] };
const history = [
    { timeStamp: now, longShortRatio: "2" },
    { timeStamp: now - period, longShortRatio: "1" },
];

test("Toobit preserves contract names and converts coin OI before price normalization", () => {
    const reading = buildToobitReading(contract, ticker, interest, history);
    assert.equal(reading.asset, "X");
    assert.equal(reading.exchangeAsset, "1000X");
    assert.equal(reading.symbol, "1000X-SWAP-USDT");
    assert.equal(reading.price, 0.02);
    assert.equal(reading.openInterestUsd, 1000);
    assert.equal(reading.priceChange24hPct, -5);
    assert.deepEqual(reading.points.map((point) => point.timestamp), [now - period, now]);
    assert.equal(buildChange("5m", period, [reading]).ratioChangePct, 100);
    assert.equal(countFetchedReadings([reading]), 1);
});

test("Toobit skips missing or invalid ratio, price and OI data", () => {
    assert.equal(buildToobitReading(contract, ticker, interest, []), null);
    assert.equal(buildToobitReading(contract, { ...ticker, c: "0" }, interest, history), null);
    assert.equal(buildToobitReading(contract, ticker, { openInterestList: [] }, history), null);
    assert.equal(buildToobitReading(contract, ticker, { openInterestList: [{ symbol: "OTHER", size: "9999" }] }, history), null);
    assert.equal(buildToobitReading(contract, ticker, interest, [{ timeStamp: now, longShortRatio: "invalid" }]), null);
});

test("Toobit aggregates with existing sources and supports multi-select filtering", () => {
    const reading = buildToobitReading(contract, ticker, interest, history);
    const binance = { ...reading, exchange: "binance", symbol: "XUSDT", exchangeAsset: "X", openInterestUsd: 3000,
        points: [{ timestamp: now - period, ratio: 2 }, { timestamp: now, ratio: 3 }] };
    const row = createRows([reading, binance])[0];
    assert.deepEqual(new Set(row.exchanges), new Set(["binance", "toobit"]));
    assert.equal(row.openInterestUsd, 4000);
    assert.ok(Math.abs(row.currentRatio - 35 / 13) < 1e-12);
    assert.equal(row.price, 0.02);
    const change = row.changes.find((item) => item.timeframe === "5m");
    assert.ok(Math.abs(change.previousRatio - 5 / 3) < 1e-12);
    assert.ok(Math.abs(change.currentRatio - 35 / 13) < 1e-12);
    assert.ok(Math.abs(change.ratioChangePct - ((35 / 13) / (5 / 3) - 1) * 100) < 1e-10);
    assert.ok(MARKET_EXCHANGES.includes("toobit"));
    assert.equal(EXCHANGE_LABELS.toobit, "Toobit");
    assert.equal(matchesExchangeFilter(["toobit"], ["toobit", "bybit"]), true);
    assert.equal(matchesExchangeFilter(["toobit"], ["binance", "bybit"]), false);
});

test("Toobit fetches active perpetuals, not spot, delivery or inactive contracts, and publishes progressively", async () => {
    const calls = [];
    const published = [];
    const result = await fetchToobit({
        request: async (url) => {
            calls.push(url);
            if (url.endsWith("/exchangeInfo")) return { symbols: [{ symbol: "XUSDT" }], contracts: [
                contract,
                { ...contract, symbol: "FAILED-SWAP-USDT" },
                { ...contract, symbol: "OLD-SWAP-USDT", status: "BREAK" },
                { ...contract, symbol: "X-202612-USDT" },
                { ...contract, symbol: "X-SWAP-BTC", quoteAsset: "BTC", inverse: true },
            ] };
            if (url.endsWith("/ticker/24hr")) return [ticker, { ...ticker, s: "FAILED-SWAP-USDT" }, { ...ticker, s: "OLD-SWAP-USDT" }, { ...ticker, s: "X-202612-USDT" }];
            if (url.includes("FAILED")) throw new Error("Upstream unavailable");
            if (url.includes("globalLongShortAccountRatio")) {
                assert.ok(url.includes("period=5m&limit=300"));
                return history;
            }
            if (url.includes("/openInterest")) return interest;
            throw new Error(`Unexpected URL: ${url}`);
        },
        onReading: (reading) => published.push(reading),
    });
    assert.equal(result.marketCount, 2);
    assert.equal(result.errorCount, 1);
    assert.equal(result.readings.length, 1);
    assert.deepEqual(published, result.readings);
    assert.ok(calls.every((url) => !url.includes("OLD") && !url.includes("202612") && !url.includes("SWAP-BTC")));
});

test("Toobit rejects an unexpected metadata response rather than silently returning an empty feed", async () => {
    await assert.rejects(fetchToobit({ request: async () => ({}), onReading: () => {} }), /invalid contract metadata/);
});

test("Toobit five-minute history supplies matching previous candles for every displayed timeframe", () => {
    const fullHistory = Array.from({ length: 300 }, (_, index) => ({
        timeStamp: now - index * period, longShortRatio: String(2 - index / 1000),
    }));
    const reading = buildToobitReading(contract, ticker, interest, fullHistory);
    for (const [timeframe, minutes] of [["5m", 5], ["15m", 15], ["30m", 30], ["1h", 60], ["4h", 240], ["24h", 1440]]) {
        const duration = minutes * 60_000;
        const candleStart = Math.floor(now / duration) * duration;
        const previous = fullHistory.find((item) => item.timeStamp < candleStart && item.timeStamp >= candleStart - duration);
        const change = buildChange(timeframe, duration, [reading]);
        assert.equal(change.currentRatio, 2);
        assert.equal(change.previousRatio, Number(previous.longShortRatio));
        assert.deepEqual(change.exchanges, ["toobit"]);
    }
});
