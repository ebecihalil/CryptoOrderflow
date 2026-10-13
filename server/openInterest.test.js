import test from "node:test";
import assert from "node:assert/strict";
import { OI_WINDOWS, underlyingPrice, coinSize, candlePair, aggregateChange, buildOiSnapshot } from "./openInterestMath.js";
import { fetchOiHistory, hasOiBackfill } from "./openInterestHistory.js";
import { validateCmeReport, CME_PRODUCTS } from "./cmeOpenInterest.js";
import { fundingReading } from "./fundingMath.js";
import { readFileSync } from "node:fs";

const now = Date.parse("2026-10-13T14:30:00Z");
const reading = (exchange, symbol, base, oiUsd, price, volume) =>
    ({ ...fundingReading(exchange, symbol, base, oiUsd, null, null, null, { markPrice: price, volume24hUsd: volume }), fetchedAt: now });
const state = readings => ({ readings, status: "live", running: false, updatedAt: new Date(now).toISOString(), error: null });
const points = (before, current) => [{ timestamp: now - 3600_000, oiCoin: before }, { timestamp: now, oiCoin: current }];

test("OI contract size normalizes multiplier aliases without rescaling USD notional", () => {
    const multiplied = reading("binance", "1000PEPEUSDT", "1000PEPE", 100, 0.01, 1000);
    const plain = reading("bybit", "PEPEUSDT", "PEPE", 200, 0.00001, 2000);
    assert.equal(underlyingPrice(multiplied), 0.00001);
    assert.equal(coinSize(multiplied), 10_000_000);
    const snapshot = buildOiSnapshot({ binance: state([multiplied]), bybit: state([plain]) }, new Map(), new Map(), "1h", now);
    assert.equal(snapshot.rows.length, 1);
    assert.equal(snapshot.rows[0].aggregateOiUsd, 300);
    assert.equal(snapshot.rows[0].aggregateOiCoin, 30_000_000);
});
test("OI display name uses a majority of exchanges, preserving a single-venue name", () => {
    const records = [
        reading("binance", "1000PEPEUSDT", "1000PEPE", 100, 0.01, 10),
        reading("bybit", "1000PEPEUSDT", "1000PEPE", 100, 0.01, 10),
        reading("gate", "PEPE_USDT", "PEPE", 100, 0.00001, 10),
    ];
    const states = Object.fromEntries(records.map(item => [item.exchange, state([item])]));
    assert.equal(buildOiSnapshot(states, new Map(), new Map(), "1h", now).rows[0].displayAsset, "1000PEPE");
    assert.equal(buildOiSnapshot({ binance: states.binance }, new Map(), new Map(), "1h", now).rows[0].displayAsset, "1000PEPE");
});
test("OI changes compare matching current/previous candle quantities, not price changes", () => {
    for (const timeframe of Object.keys(OI_WINDOWS)) {
        const duration = OI_WINDOWS[timeframe], boundary = Math.floor(now / duration) * duration;
        const pair = candlePair([{ timestamp: boundary - 1, oiCoin: 50 }, { timestamp: boundary + 1, oiCoin: 55 }], timeframe, boundary + 2);
        assert.deepEqual(pair, { current: 55, previous: 50 });
        assert.ok(Math.abs(aggregateChange([pair]) - 10) < 1e-10);
    }
});
test("missing, future, non-adjacent or zero-baseline observations do not create an OI change", () => {
    assert.equal(candlePair([{ timestamp: now, oiCoin: 10 }], "1h", now), null);
    assert.equal(candlePair([{ timestamp: now - 2 * 3600_000, oiCoin: 10 }, { timestamp: now, oiCoin: 20 }], "1h", now), null);
    assert.equal(candlePair(points(0, 20), "1h", now), null);
    assert.equal(candlePair([{ timestamp: now - 3600_000, oiCoin: null }, { timestamp: now, oiCoin: 20 }], "1h", now), null);
    assert.equal(aggregateChange([]), null);
});
test("aggregation is a sum and uses exactly the same matched contracts for changes", () => {
    const a = reading("binance", "BTCUSDT", "BTC", 11000, 100, 10000);
    const b = reading("bybit", "BTCUSDT", "BTC", 30000, 100, 20000);
    const h = new Map([["binance:BTCUSDT", points(100, 110)]]);
    const snapshot = buildOiSnapshot({ binance: state([a]), bybit: state([b]) }, h, new Map(), "1h", now);
    assert.equal(snapshot.rows[0].aggregateOiUsd, 41000);
    assert.equal(snapshot.rows[0].aggregateOiCoin, 410);
    assert.ok(Math.abs(snapshot.rows[0].changePct - 10) < 1e-10);
    assert.equal(snapshot.rows[0].matchedSourceCount, 1);
});
test("OI/volume ratio compares identical venue coverage and does not count missing volumes as zero", () => {
    const a = reading("binance", "BTCUSDT", "BTC", 100, 10, 500);
    const b = reading("bybit", "BTCUSDT", "BTC", 900, 10, null);
    const row = buildOiSnapshot({ binance: state([a]), bybit: state([b]) }, new Map(), new Map(), "1h", now).rows[0];
    assert.equal(row.aggregateOiUsd, 1000);
    assert.equal(row.oiVolumeRatio, 0.2);
    assert.equal(row.volumeSourceCount, 1);
});
test("CME daily OI contributes to totals but never fabricates intraday changes or rolling volume", () => {
    const a = reading("binance", "BTCUSDT", "BTC", 11000, 100, 50000);
    const cme = { ...reading("cme", "BTC:ALL", "BTC", 5000, 100, null), oiCoin: 50, reportDate: "2026-10-12" };
    const h = new Map([["binance:BTCUSDT", points(100, 110)], ["cme:BTC:ALL", points(20, 50)]]);
    const snapshot = buildOiSnapshot({ binance: state([a]), cme: state([cme]) }, h, new Map(), "1h", now);
    assert.equal(snapshot.rows[0].aggregateOiUsd, 16000);
    assert.equal(snapshot.rows[0].aggregateOiCoin, 160);
    assert.ok(Math.abs(snapshot.rows[0].changePct - 10) < 1e-10);
    assert.equal(snapshot.rows[0].venues.cme.changePct, null);
    assert.equal(snapshot.rows[0].oiVolumeRatio, 11000 / 50000);
    assert.deepEqual(snapshot.cmeReportDates, ["2026-10-12"]);
});
test("CME standard and micro contract units are validated and converted independently", () => {
    const report = validateCmeReport({ reportDate: "2026-10-12", sourceUrl: "https://www.cmegroup.com/market-data/volume-open-interest.html",
        records: [{ productCode: "BTC", contract: "ALL", openInterestContracts: 2 },
            { productCode: "MBT", contract: "ALL", openInterestContracts: 10 },
            { productCode: "ETH", contract: "OCT26", openInterestContracts: 3 }] }, now);
    assert.deepEqual(report.records.map(record => record.oiCoin), [10, 1, 150]);
    assert.equal(CME_PRODUCTS.MXP[1], 2500);
    assert.equal(CME_PRODUCTS.MCA[1], 10000);
});
test("CME report rejects duplicates, totals plus expiry rows, unknown units and future dates", () => {
    const base = { reportDate: "2026-10-12", sourceUrl: "https://www.cmegroup.com/market-data/volume-open-interest.html",
        records: [{ productCode: "BTC", contract: "ALL", openInterestContracts: 2 }] };
    assert.throws(() => validateCmeReport({ ...base, records: [...base.records, ...base.records] }, now), /Duplicate/);
    assert.throws(() => validateCmeReport({ ...base, records: [...base.records, { ...base.records[0], contract: "OCT26" }] }, now), /product total/);
    assert.throws(() => validateCmeReport({ ...base, records: [{ ...base.records[0], productCode: "UNKNOWN" }] }, now), /Unverified/);
    assert.throws(() => validateCmeReport({ ...base, reportDate: "2027-01-01" }, now), /future/);
    assert.throws(() => validateCmeReport({ ...base, sourceUrl: "https://example.com/report?api_key=secret" }, now), /credentials/);
});
test("top-five gainers and losers exclude zero and missing changes", () => {
    const records = [reading("bybit", "AUSDT", "A", 10, 1, 100), reading("bybit", "BUSDT", "B", 10, 1, 100), reading("bybit", "CUSDT", "C", 10, 1, 100)];
    const h = new Map([["bybit:AUSDT", points(10, 11)], ["bybit:BUSDT", points(10, 9)], ["bybit:CUSDT", points(10, 10)]]);
    const snapshot = buildOiSnapshot({ bybit: state(records) }, h, new Map(), "1h", now);
    assert.deepEqual(snapshot.extremes.gainers.map(row => row.asset), ["A"]);
    assert.deepEqual(snapshot.extremes.losers.map(row => row.asset), ["B"]);
});
test("multi-exchange selection recomputes OI sums, changes and ratios for selected venues", () => {
    const a = reading("binance", "BTCUSDT", "BTC", 100, 10, 500), b = reading("bybit", "BTCUSDT", "BTC", 200, 10, 1000);
    const row = buildOiSnapshot({ binance: state([a]), bybit: state([b]) }, new Map(), new Map(), "1h", now, ["bybit"]).rows[0];
    assert.equal(row.aggregateOiUsd, 200);
    assert.deepEqual(Object.keys(row.venues), ["bybit"]);
});
test("history adapters use the shared client and retain coin-unit multipliers without creating missing-data zeros", async () => {
    const requests = [], item = reading("binance", "1000PEPEUSDT", "1000PEPE", 100, 0.01, 1000);
    const points = await fetchOiHistory(async url => { requests.push(url); return [
        { timestamp: now - 300_000, sumOpenInterest: "10" }, { timestamp: now, sumOpenInterest: null },
    ]; }, item, "1h", now);
    assert.equal(points.length, 1); assert.equal(points[0].oiCoin, 10000);
    assert.match(requests[0], /period=5m/);
    assert.equal(hasOiBackfill({ ...item, symbol: "BTCUSD_PERP" }), false);
});
test("Bybit backfill obtains both prior-candle and latest five-minute observations", async () => {
    const requests = [], item = reading("bybit", "BTCUSDT", "BTC", 100, 10, 1000);
    await fetchOiHistory(async url => { requests.push(new URL(url)); return { result: { list: [{ timestamp: now, openInterest: "10" }] } }; }, item, "24h", now);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].searchParams.get("intervalTime"), "5min");
    assert.ok(Number(requests[0].searchParams.get("endTime")) < Math.floor(now / 86400_000) * 86400_000);
});

test("Bybit historical OI uses its single-sided field and only halves the documented both-sided fallback", async () => {
    const item = reading("bybit", "BTCUSDT", "BTC", 1100, 10, 500);
    const before = Math.floor(now / 3600_000) * 3600_000 - 300_000;
    let call = 0;
    const result = await fetchOiHistory(async () => ({ result: { list: call++ === 0
        ? [{ timestamp: before, openInterest: "200", singleOpenInterest: "100" }]
        : [{ timestamp: now, openInterest: "220" }] } }), item, "1h", now);
    assert.deepEqual(result.map(point => point.oiCoin), [100, 110]);
    assert.ok(Math.abs(aggregateChange([candlePair(result, "1h", now)]) - 10) < 1e-10);
});
test("Gate history and current position size are compared on the same single-sided contract basis", async () => {
    const item = { ...reading("gate", "BTC_USDT", "BTC", 1100, 10, 500), contractSizeCoin: 0.01 };
    const before = Math.floor(now / 3600_000) * 3600_000 - 300_000;
    let call = 0;
    const result = await fetchOiHistory(async () => call++ === 0
        ? [{ time: before / 1000, open_interest: 20000 }]
        : [{ time: now / 1000, open_interest: 22000 }], item, "1h", now);
    assert.deepEqual(result.map(point => point.oiCoin), [100, 110]);
    assert.ok(Math.abs(aggregateChange([candlePair(result, "1h", now)]) - 10) < 1e-10);
});
test("OI collection shares Funding inventory, persists real observations and has no forced-refresh route", () => {
    const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(read("server/openInterestMarketData.js"), /getPerpetualInventory\(\)/);
    assert.match(read("server/openInterestMarketData.js"), /points\.at\(-1\)\?\.timestamp === item\.fetchedAt/);
    assert.match(read("server/openInterestMarketData.js"), /setInterval\(backgroundTick, 30_000\)/);
    assert.match(read("server/openInterestVolume.js"), /requestJson/);
    assert.match(read("server.js"), /app\.get\("\/api\/market\/open-interest"/);
    assert.doesNotMatch(read("src/hooks/use-open-interest-snapshot.ts"), /force|localhost/);
});
