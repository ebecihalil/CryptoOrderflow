import test from "node:test";
import assert from "node:assert/strict";
import { buildChange, canonicalAsset, createRows } from "./lsarMarketData.js";

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

test("numeric contract multipliers normalize to the same underlying coin", () => {
    for (const multiplier of [100, 1000, 10000, 100000, 1000000]) {
        assert.deepEqual(canonicalAsset(`${multiplier}X`), { asset: "X", priceDivisor: multiplier });
    }
    assert.deepEqual(canonicalAsset("1000x"), { asset: "X", priceDivisor: 1000 });
    assert.deepEqual(canonicalAsset("1KX"), { asset: "X", priceDivisor: 1000 });
    assert.deepEqual(canonicalAsset("1MX"), { asset: "X", priceDivisor: 1000000 });
});

test("ordinary numbered asset names retain their identity", () => {
    for (const asset of ["1INCH", "2Z", "4", "10X", "100", "123X"]) {
        assert.deepEqual(canonicalAsset(asset), { asset, priceDivisor: 1 });
    }
});

test("multiplier and plain contracts aggregate with per-coin prices and unchanged USD OI", () => {
    const now = Math.floor(Date.now() / period) * period;
    const fixtures = [
        { base: "X", exchange: "binance", price: 0.02, weight: 100, ratio: 1 },
        { base: "100X", exchange: "bybit", price: 2, weight: 200, ratio: 2 },
        { base: "1000X", exchange: "okx", price: 20, weight: 300, ratio: 3 },
        { base: "10000X", exchange: "gate", price: 200, weight: 400, ratio: 4 },
        { base: "100000X", exchange: "bitget", price: 2000, weight: 500, ratio: 5 },
    ];
    const readings = fixtures.map((item) => {
        const normalized = canonicalAsset(item.base);
        return {
            asset: normalized.asset, exchange: item.exchange, symbol: `${item.base}USDT`,
            exchangeAsset: item.base,
            price: item.price / normalized.priceDivisor, priceChange24hPct: null,
            openInterestUsd: item.weight,
            points: [{ timestamp: now - period, ratio: item.ratio / 2 }, { timestamp: now, ratio: item.ratio }],
        };
    });
    const rows = createRows(readings);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].asset, "X");
    assert.ok(Math.abs(rows[0].price - 0.02) < 1e-12);
    assert.equal(rows[0].openInterestUsd, 1500);
    assert.ok(Math.abs(rows[0].currentRatio - 5500 / 1500) < 1e-12);
    assert.equal(rows[0].exchanges.length, 5);
    assert.ok(Math.abs(rows[0].changes.find((change) => change.timeframe === "5m").ratioChangePct - 100) < 1e-10);
    assert.deepEqual(rows[0].exchangeReadings.map((item) => item.symbol), fixtures.map((item) => `${item.base}USDT`));
});

function namedReading(exchange, name, weight = 100, symbol = `${name}USDT`) {
    return {
        asset: canonicalAsset(name).asset, exchangeAsset: name, exchange, symbol,
        price: 0.02, priceChange24hPct: null, openInterestUsd: weight,
        points: [{ timestamp: Date.now(), ratio: 1 }],
    };
}

test("display name follows the majority of exchanges, not the highest OI", () => {
    const rows = createRows([
        namedReading("binance", "1000X"),
        namedReading("bybit", "1000X"),
        namedReading("gate", "X", 1000000),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].asset, "X");
    assert.equal(rows[0].displayAsset, "1000X");
});

test("a single-exchange coin retains that exchange's original name", () => {
    for (const name of ["1000X", "X", "1000x", "x"]) {
        assert.equal(createRows([namedReading("bybit", name)])[0].displayAsset, name);
    }
});

test("multiple contracts on one exchange do not outvote two other exchanges", () => {
    const rows = createRows([
        namedReading("binance", "1000X", 1000, "1000XUSDT"),
        namedReading("binance", "1000X", 1000, "1000XUSDC"),
        namedReading("binance", "1000X", 1000, "1000XUSD"),
        namedReading("bybit", "X"), namedReading("gate", "X"),
    ]);
    assert.equal(rows[0].displayAsset, "X");
    assert.equal(rows[0].exchanges.length, 3);
});

test("tied display-name votes use USD OI as a deterministic tiebreaker", () => {
    assert.equal(createRows([namedReading("binance", "1000X", 300), namedReading("bybit", "X", 100)])[0].displayAsset, "1000X");
});
