import test from "node:test";
import assert from "node:assert/strict";
import { exchangeAccountRatio } from "../src/lib/exchange-ratios.ts";
import { compareMarketRows } from "../src/lib/market-sort.ts";
import { coinLogoUrl } from "../src/lib/coin-logos.ts";

const reading = (exchange, longShortRatio, openInterestUsd) => ({ exchange, longShortRatio, openInterestUsd });

test("individual venues use only their own contracts and weight multiple contracts by USD OI", () => {
    const readings = [reading("binance", 1, 100), reading("binance", 3, 300), reading("bybit", 10, 1000)];
    assert.ok(Math.abs(exchangeAccountRatio(readings, "binance") - 2.5) < 1e-12);
    assert.equal(exchangeAccountRatio(readings, "bybit"), 10);
    assert.equal(exchangeAccountRatio(readings, "toobit"), null);
});

test("missing or invalid ratio and OI data never fabricate an exchange reading", () => {
    const readings = [reading("gate", null, 100), reading("gate", NaN, 100), reading("gate", 2, 0),
        reading("gate", 2, -1), reading("gate", 2, Infinity), reading("gate", -1, 100)];
    assert.equal(exchangeAccountRatio(readings, "gate"), null);
    assert.equal(exchangeAccountRatio([...readings, reading("gate", 1.5, 200)], "gate"), 1.5);
});

test("venue-level ratios preserve the global weighted account ratio", () => {
    const readings = [reading("binance", 1, 100), reading("binance", 3, 300), reading("bybit", 2, 600)];
    const aggregate = (exchangeAccountRatio(readings, "binance") * 400 + exchangeAccountRatio(readings, "bybit") * 600) / 1000;
    assert.ok(Math.abs(aggregate - 2.2) < 1e-12);
});

test("exchange columns sort numerically in both directions, leaving absent venues last", () => {
    const row = (asset, ratio) => ({ asset, currentRatio: 5, changes: [],
        exchangeReadings: ratio === null ? [] : [reading("okx", ratio, 100)] });
    const rows = [row("MISSING", null), row("LOW", 0.5), row("HIGH", 3)];
    const sorted = (mode) => [...rows].sort((a, b) => compareMarketRows(a, b, "4h", mode, "okx")).map((item) => item.asset);
    assert.deepEqual(sorted("increase"), ["HIGH", "LOW", "MISSING"]);
    assert.deepEqual(sorted("decrease"), ["LOW", "HIGH", "MISSING"]);
});

test("coin logo requests use canonical tickers and reject invalid paths", () => {
    assert.equal(coinLogoUrl("FLOKI"), "https://s2.coinmarketcap.com/static/img/coins/64x64/10804.png");
    assert.equal(coinLogoUrl(" btc "), "https://s2.coinmarketcap.com/static/img/coins/64x64/1.png");
    assert.equal(coinLogoUrl("../btc"), null);
    assert.equal(coinLogoUrl(""), null);
});
