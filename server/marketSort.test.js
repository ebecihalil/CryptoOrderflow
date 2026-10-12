import test from "node:test";
import assert from "node:assert/strict";
import { compareMarketRows, nextHeaderSortMode } from "../src/lib/market-sort.ts";

const row = (asset, currentRatio, change) => ({ asset, currentRatio, changes: [
    { timeframe: "1h", ratioChangePct: change },
    { timeframe: "4h", ratioChangePct: -change },
] });
const fixtures = [row("LOW", 0.5, 20), row("HIGH", 3, -30), row("MID", 1.5, 10)];
const order = (mode, target, timeframe = "1h", rows = fixtures) =>
    [...rows].sort((a, b) => compareMarketRows(a, b, timeframe, mode, target)).map((item) => item.asset);

test("current LSAR sorts numerically in both directions, independently of timeframe changes", () => {
    assert.deepEqual(order("increase", "current"), ["HIGH", "MID", "LOW"]);
    assert.deepEqual(order("decrease", "current"), ["LOW", "MID", "HIGH"]);
    assert.deepEqual(order("increase", "current", "4h"), ["HIGH", "MID", "LOW"]);
});

test("header clicks start descending then toggle ascending and descending", () => {
    assert.equal(nextHeaderSortMode(false, "absolute"), "increase");
    assert.equal(nextHeaderSortMode(false, "increase"), "increase");
    assert.equal(nextHeaderSortMode(true, "increase"), "decrease");
    assert.equal(nextHeaderSortMode(true, "decrease"), "increase");
});

test("missing current ratios stay last in both directions and ties are stable", () => {
    const rows = [row("B", 2, 1), row("NONE", null, 1), row("A", 2, 1), row("INVALID", NaN, 1)];
    assert.deepEqual(order("increase", "current", "1h", rows), ["A", "B", "INVALID", "NONE"]);
    assert.deepEqual(order("decrease", "current", "1h", rows), ["A", "B", "INVALID", "NONE"]);
});

test("existing timeframe increase, decrease and largest-move sorts are preserved", () => {
    assert.deepEqual(order("increase", "change"), ["LOW", "MID", "HIGH"]);
    assert.deepEqual(order("decrease", "change"), ["HIGH", "MID", "LOW"]);
    assert.deepEqual(order("absolute", "change"), ["HIGH", "LOW", "MID"]);
    assert.deepEqual(order("increase", "change", "4h"), ["HIGH", "MID", "LOW"]);
});
