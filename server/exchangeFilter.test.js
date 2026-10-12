import test from "node:test";
import assert from "node:assert/strict";
import { MARKET_EXCHANGES, matchesExchangeFilter, selectExchanges, selectMultipleOnly } from "../src/lib/exchange-options.ts";
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

test("multi-exchange mode works with all individual boxes unchecked", () => {
    assert.equal(matchesExchangeFilter(["binance"], [], true), false);
    assert.equal(matchesExchangeFilter(["binance", "gate"], [], true), true);
    assert.equal(matchesExchangeFilter(["gate", "okx"], [], true), true);
    assert.equal(matchesExchangeFilter(["binance", "binance"], [], true), false);
});

test("selecting multi-exchange-only clears every individual exchange", () => {
    const state = selectMultipleOnly(true);
    assert.deepEqual(state.selected, []);
    assert.equal(state.multipleOnly, true);
    assert.equal(matchesExchangeFilter(["bybit", "toobit"], state.selected, state.multipleOnly), true);
    assert.deepEqual(selectMultipleOnly(false), { selected: [], multipleOnly: false });
});

test("selecting individual exchanges, all or none exits multi-exchange-only mode", () => {
    for (const selected of [["toobit"], ["binance", "bybit"], MARKET_EXCHANGES, []]) {
        const state = selectExchanges(selected);
        assert.deepEqual(state.selected, selected);
        assert.equal(state.multipleOnly, false);
    }
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
