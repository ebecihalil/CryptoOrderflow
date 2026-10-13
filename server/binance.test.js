import test from "node:test";
import assert from "node:assert/strict";
import { fetchBinanceLinear, fetchBinanceCoinM } from "./lsarMarketData.js";
import { snapshotPollInterval } from "../src/lib/snapshot-polling.ts";

const now = Math.floor(Date.now() / 300_000) * 300_000;
const history = [
    { timestamp: now - 300_000, longShortRatio: "1" },
    { timestamp: now, longShortRatio: "2" },
];

for (const inverse of [false, true]) {
    test(`Binance ${inverse ? "COIN-M" : "USD-M"} publishes completed contracts before a slower contract finishes`, async () => {
        const first = inverse ? "ALPHAUSD_PERP" : "ALPHAUSDT";
        const second = inverse ? "1000BETAUSD_PERP" : "1000BETAUSDC";
        const symbols = [
            { symbol: first, pair: "ALPHAUSD", baseAsset: "ALPHA", quoteAsset: "USDT", contractSize: 100 },
            { symbol: second, pair: "1000BETAUSD", baseAsset: "1000BETA", quoteAsset: "USDC", contractSize: 10 },
        ].map(item => ({ ...item, contractType: "PERPETUAL", status: "TRADING", contractStatus: "TRADING" }));
        let release;
        const slow = new Promise(resolve => { release = resolve; });
        const published = [];
        const requestedSymbols = [];
        const request = async (value) => {
            const url = new URL(value);
            if (url.pathname.endsWith("/exchangeInfo")) return {
                symbols: [...symbols, { ...symbols[0], symbol: "DELIVERY", contractType: "CURRENT_QUARTER" }],
            };
            if (url.pathname.endsWith("/ticker/price")) return [
                { symbol: first, price: "8" }, { symbol: second, price: "2" },
            ];
            if (url.pathname.endsWith("/ticker/24hr")) return [
                { symbol: first, priceChangePercent: "1" }, { symbol: second, priceChangePercent: "2" },
            ];
            if (url.pathname.endsWith("/globalLongShortAccountRatio")) {
                const symbol = url.searchParams.get(inverse ? "pair" : "symbol");
                requestedSymbols.push(symbol);
                assert.equal(url.searchParams.get("period"), "5m");
                assert.equal(url.searchParams.get("limit"), "300");
                if (symbol === (inverse ? "1000BETAUSD" : second)) await slow;
                return history;
            }
            if (url.pathname.endsWith("/openInterest")) return { openInterest: "5" };
            throw Error(`Unexpected endpoint: ${url.pathname}`);
        };
        let finished = false;
        const task = (inverse ? fetchBinanceCoinM : fetchBinanceLinear)({
            request, onReading: reading => published.push(reading),
        }).then(result => { finished = true; return result; });
        try {
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(finished, false);
            assert.equal(published.length, 1);
            assert.equal(published[0].symbol, first);
            // Do not speed up loading by skipping contracts priced above $5.
            assert.equal(published[0].price, 8);
            assert.equal(published[0].openInterestUsd, inverse ? 500 : 40);
        } finally {
            release();
        }
        const result = await task;
        assert.equal(result.errorCount, 0);
        assert.equal(result.readings.length, 2);
        assert.equal(published.length, 2);
        assert.equal(requestedSymbols.length, 2);
        assert.equal(published[1].asset, "BETA");
        assert.equal(published[1].price, 0.002);
        assert.equal(published[1].openInterestUsd, inverse ? 50 : 10);
        assert.deepEqual(published[1].points, history.map(point => ({
            timestamp: point.timestamp, ratio: Number(point.longShortRatio),
        })));
    });
}

test("poll snapshots faster only while Binance is connecting or scanning", () => {
    for (const status of ["connecting", "refreshing"])
        assert.equal(snapshotPollInterval([{ exchange: "binance", status }]), 5_000);
    for (const status of ["live", "delayed", "error"])
        assert.equal(snapshotPollInterval([{ exchange: "binance", status }]), 30_000);
    assert.equal(snapshotPollInterval([{ exchange: "bitget", status: "refreshing" }]), 30_000);
    assert.equal(snapshotPollInterval(), 30_000);
});
