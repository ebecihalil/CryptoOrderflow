import test from "node:test";
import assert from "node:assert/strict";
import { weightedAccountRatio } from "./lsarAggregation.js";
import { buildChange, createRows } from "./lsarMarketData.js";
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const period = 300_000, now = Math.floor(Date.now() / period) * period;
const reading = (exchange, weight, previous, current) => ({
    asset: "ALGO", exchangeAsset: "ALGO", symbol: `ALGO:${exchange}`, exchange,
    price: 0.12, priceChange24hPct: null, openInterestUsd: weight,
    points: [{ timestamp: now - period, ratio: previous }, { timestamp: now, ratio: current }],
});
const expectedRatio = items => {
    const long = items.reduce((total, x) => total + x.weight * x.ratio / (1 + x.ratio), 0);
    const short = items.reduce((total, x) => total + x.weight / (1 + x.ratio), 0);
    return long / short;
};
test("share-first weighting does not let a huge raw ratio dominate modest OI", () => {
    const items = [
        { weight: 63.5, ratio: 2.828 }, { weight: 19.2, ratio: 1.349 },
        { weight: 4.4, ratio: 1.130 }, { weight: 12.9, ratio: 118.4 },
    ];
    const result = weightedAccountRatio(items);
    close(result, expectedRatio(items));
    assert.ok(result > 2.7 && result < 2.72);
    const longPct = items.reduce((total, x) => total + x.weight * x.ratio / (1 + x.ratio), 0);
    close(100 * result / (1 + result), longPct);
    assert.ok(100 * result / (1 + result) < 74);
});
test("one contributing venue retains its exact ratio and genuine large OI dominance remains", () => {
    assert.equal(weightedAccountRatio([{ ratio: 118.4, weight: 2_300_000 }]), 118.4);
    const items = [{ ratio: 1.26, weight: 4.3 }, { ratio: 18, weight: 95.7 }];
    assert.ok(weightedAccountRatio(items) > 13);
    close(weightedAccountRatio(items), expectedRatio(items));
});
test("normalizing weights avoids overflow and is invariant to OI currency scaling", () => {
    const items = [{ ratio: 2, weight: 1e308 }, { ratio: 3, weight: 1e308 }];
    close(weightedAccountRatio(items), 17 / 7);
    close(weightedAccountRatio(items.map(x => ({ ...x, weight: x.weight / 1e306 }))), 17 / 7);
    assert.equal(weightedAccountRatio([{ ratio: 1e300, weight: 1 }, { ratio: 1e300, weight: 2 }]), 1e300);
});
test("empty, invalid ratios and invalid OI are unavailable, never fabricated or equally weighted", () => {
    assert.equal(weightedAccountRatio([]), null);
    const invalid = [{ ratio: null, weight: 10 }, { ratio: 0, weight: 10 }, { ratio: -1, weight: 10 },
        { ratio: Infinity, weight: 10 }, { ratio: 2, weight: null }, { ratio: 2, weight: 0 }, { ratio: 2, weight: NaN }];
    assert.equal(weightedAccountRatio(invalid), null);
    assert.equal(weightedAccountRatio([...invalid, { ratio: 2, weight: 100 }]), 2);
});
test("current aggregated LSAR and displayed long share use the same share-first calculation", () => {
    const readings = [reading("bybit", 90, 1, 2), reading("toobit", 10, 1, 118.4)];
    const row = createRows(readings)[0], expected = expectedRatio([{ weight: 90, ratio: 2 }, { weight: 10, ratio: 118.4 }]);
    close(row.currentRatio, expected);
    close(row.longSharePct, 100 * expected / (1 + expected));
    assert.deepEqual(row.exchangeReadings.map(r => r.longShortRatio), [2, 118.4]);
    assert.deepEqual(row.exchangeReadings.map(r => r.openInterestUsd), [90, 10]);
    close(row.changes.find(c => c.timeframe === "5m").currentRatio, row.currentRatio);
});
test("every TF reconstructs both candles from share-weighted identical matched sources", () => {
    for (const [tf, duration] of [["5m", period], ["15m", 3 * period], ["30m", 6 * period],
        ["1h", 12 * period], ["4h", 48 * period], ["24h", 288 * period]]) {
        const boundary = Math.floor(now / duration) * duration;
        const a = reading("bybit", 90, 1, 2), b = reading("toobit", 10, 2, 118.4);
        for (const r of [a, b]) r.points = r.points.map((p, i) => ({ ...p, timestamp: boundary - period + i * period }));
        const missing = { ...reading("gate", 100000, 1, 1000), points: [{ timestamp: boundary, ratio: 1000 }] };
        const result = buildChange(tf, duration, [a, b, missing]);
        const expectedCurrent = expectedRatio([{ weight: 90, ratio: 2 }, { weight: 10, ratio: 118.4 }]);
        const expectedPrevious = expectedRatio([{ weight: 90, ratio: 1 }, { weight: 10, ratio: 2 }]);
        close(result.currentRatio, expectedCurrent); close(result.previousRatio, expectedPrevious);
        close(result.ratioChangePct, (expectedCurrent / expectedPrevious - 1) * 100);
        close(result.longShareChangePp, 100 * (expectedCurrent / (1 + expectedCurrent) - expectedPrevious / (1 + expectedPrevious)));
        assert.deepEqual(result.exchanges, ["bybit", "toobit"]);
    }
});
test("an invalid baseline excludes the same source from both candles", () => {
    const valid = reading("bybit", 100, 1, 2), invalid = reading("toobit", 100000, NaN, 118.4);
    const result = buildChange("5m", period, [valid, invalid]);
    assert.deepEqual(result.exchanges, ["bybit"]);
    assert.equal(result.previousRatio, 1); assert.equal(result.currentRatio, 2);
    assert.equal(result.ratioChangePct, 100);
});
