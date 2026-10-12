import test from "node:test";
import assert from "node:assert/strict";
import { MARKET_EXCHANGES, matchesExchangeFilter } from "../src/lib/exchange-options.ts";
import { countFetchedReadings } from "./lsarMarketData.js";

test("multiple selected exchanges match any chosen venue", () => {
    assert.equal(matchesExchangeFilter(["binance"], ["binance", "bybit"]), true);
    assert.equal(matchesExchangeFilter(["bybit", "okx"], ["binance", "bybit"]), true);
    assert.equal(matchesExchangeFilter(["gate"], ["binance", "bybit"]), false);
});

test("select all and clear all have explicit behavior", () => {
    assert.equal(matchesExchangeFilter(["bitget"], MARKET_EXCHANGES), true);
    assert.equal(matchesExchangeFilter(["binance", "bybit"], []), false);
});

test("multi-exchange requirement works alongside the selected venues", () => {
    assert.equal(matchesExchangeFilter(["binance"], ["binance", "bybit"], true), false);
    assert.equal(matchesExchangeFilter(["binance", "gate"], ["binance", "bybit"], true), true);
    assert.equal(matchesExchangeFilter(["gate", "okx"], ["binance", "bybit"], true), false);
});

test("fetched count includes only fresh complete contract data", () => {
    const now = Date.now();
    const valid = { price: 50, openInterestUsd: 500, points: [{ timestamp: now, ratio: 1.2 }] };
    assert.equal(countFetchedReadings([
        valid,
        { ...valid, price: 0 },
        { ...valid, openInterestUsd: null },
        { ...valid, points: [] },
        { ...valid, points: [{ timestamp: now - 16 * 60_000, ratio: 1.2 }] },
        { ...valid, points: [{ timestamp: now, ratio: 0 }] },
    ], now), 1);
    // Successful-fetch counts are independent of the UI's $5 price cap.
    assert.equal(countFetchedReadings([valid], now), 1);
});
