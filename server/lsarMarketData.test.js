import test from "node:test";
import assert from "node:assert/strict";
import { buildChange } from "./lsarMarketData.js";

const period = 5 * 60_000;
const start = Date.UTC(2026, 9, 13, 12);
const reading = (exchange, weight, previous, current) => ({
    exchange, openInterestUsd: weight,
    points: [{ timestamp: start - period, ratio: previous }, { timestamp: start, ratio: current }],
});

test("ratio change uses current candle versus previous candle", () => {
    const change = buildChange("5m", period, [reading("binance", 100, 1, 1.1)]);
    assert.ok(Math.abs(change.ratioChangePct - 10) < 1e-10);
});

test("both candle aggregates use matching venues and identical OI weights", () => {
    const missing = { exchange: "gate", openInterestUsd: 10000, points: [{ timestamp: start, ratio: 10 }] };
    const change = buildChange("5m", period, [reading("binance", 100, 1, 2), reading("bybit", 300, 2, 3), missing]);
    assert.equal(change.previousRatio, 1.75);
    assert.equal(change.currentRatio, 2.75);
    assert.deepEqual(change.exchanges, ["binance", "bybit"]);
});

test("a delayed venue does not compare its old candle to a different current candle", () => {
    const delayed = reading("gate", 100, 2, 4);
    delayed.points = delayed.points.map((point) => ({ ...point, timestamp: point.timestamp - period }));
    const change = buildChange("5m", period, [reading("binance", 100, 1, 1.1), delayed]);
    assert.deepEqual(change.exchanges, ["binance"]);
});

test("larger intervals use hourly history only for the prior long-window candle", () => {
    const source = reading("bitget", 100, 1, 2);
    source.points = source.points.filter((point) => point.timestamp >= start);
    source.longWindowPoints = [{ timestamp: start - 60 * 60_000, ratio: 1 }];
    const change = buildChange("4h", 4 * 60 * 60_000, [source]);
    assert.equal(change.ratioChangePct, 100);
});
