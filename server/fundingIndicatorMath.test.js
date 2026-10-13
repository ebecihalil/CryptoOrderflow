import test from "node:test";
import assert from "node:assert/strict";
import { aggregateFundingRates, selectFundingIndicatorSources, normalizedSettledRates,
  settledFundingChart, recordedFundingChart, validateFundingIndicatorQuery } from "./fundingIndicatorMath.js";

test("script mean, even/odd median, nonnegative OI weights and explicit mean fallback", () => {
  const result = aggregateFundingRates([{ ratePct: 0.01, oiUsd: 100 }, { ratePct: -0.03, oiUsd: 300 },
    { ratePct: 0.08, oiUsd: -50 }, { ratePct: null, oiUsd: 10000 }]);
  assert.equal(result.meanPct, 0.02);
  assert.equal(result.medianPct, 0.01);
  assert.ok(Math.abs(result.weightedPct + 0.02) < 1e-12);
  assert.equal(result.sourceCount, 3);
  assert.equal(result.weightedFallback, false);
  assert.equal(aggregateFundingRates([{ ratePct: 0.01 }, { ratePct: 0.03, oiUsd: 0 }]).medianPct, 0.02);
  assert.equal(aggregateFundingRates([{ ratePct: 0.01 }, { ratePct: 0.03, oiUsd: 0 }]).weightedFallback, true);
  assert.equal(aggregateFundingRates([]).weightedPct, null);
});

test("normalize ticker variants, aliases and query validation without stripping 1INCH", () => {
  assert.equal(validateFundingIndicatorQuery({ asset: "1000pepeusdt.p" }).asset, "PEPE");
  assert.equal(validateFundingIndicatorQuery({ asset: "XBT" }).asset, "BTC");
  assert.equal(validateFundingIndicatorQuery({ asset: "XDG" }).asset, "DOGE");
  assert.equal(validateFundingIndicatorQuery({ asset: "1INCH" }).asset, "1INCH");
  assert.throws(() => validateFundingIndicatorQuery({ asset: ["BTC"] }), /crypto asset/);
  assert.throws(() => validateFundingIndicatorQuery({ timeframe: "__proto__" }), /supported/);
  assert.throws(() => validateFundingIndicatorQuery({ asset: "../../secret" }), /ticker/);
  assert.throws(() => validateFundingIndicatorQuery({ window: "1y" }), /supported/);
  assert.throws(() => validateFundingIndicatorQuery({ asset: "TSLA" }), /cryptocurrency/);
});

const now = Date.UTC(2026, 9, 14);
const item = (symbol, ratePct, hours, oiUsd, fetchedAt = now) =>
  ({ exchange: "bybit", asset: "BTC", symbol, ratePct, intervalHours: hours, oiUsd, fetchedAt });
test("all supported venues participate without global 1% cutoff; one highest-OI contract per venue", () => {
  const sources = selectFundingIndicatorSources({
    bybit: { readings: [item("BTCUSDT", 0.01, 1, 500), item("BTCUSD", 0.8, 8, 10)], running: false },
    kraken: { readings: [{ ...item("PI_XBTUSD", -0.001, 1, 1), exchange: "kraken" }], running: false },
  }, "BTC", now);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].symbol, "BTCUSDT");
  assert.equal(sources[0].ratePct, 0.08);
  assert.equal(sources[1].ratePct, -0.008);
  assert.equal(sources[1].status, "ok");
});

test("missing interval, stale quotes, future timestamps and missing venue data are not zeros", () => {
  const sources = selectFundingIndicatorSources({
    bybit: { readings: [item("BTCUSDT", 0.01, null, 500)], running: false },
    okx: { readings: [item("BTC-USDT-SWAP", 0.1, 8, 20, now - 901000)], running: false },
    gate: { readings: [item("BTC_USDT", 0.1, 8, 20, now + 120000)], running: false },
    binance: { readings: [], running: true },
  }, "BTC", now);
  assert.ok(sources.every(source => source.ratePct === null));
  assert.equal(sources.find(source => source.exchange === "binance").status, "loading");
});

test("a stale primary contract does not hide another verified fresh contract at that venue", () => {
  const sources = selectFundingIndicatorSources({ bybit: { running: false, readings: [
    item("BTCUSDT", 0.1, 8, 1000, now - 901000), item("BTCUSD", 0.02, 8, 500),
  ] } }, "BTC", now);
  assert.equal(sources[0].symbol, "BTCUSD");
  assert.equal(sources[0].ratePct, 0.02);
});

test("settled history infers each payment's changing interval, not today's quote frequency", () => {
  const t = now - 24 * 3600000;
  const entry = { points: [
    { timestamp: t, ratePct: 0.02 }, { timestamp: t + 8 * 3600000, ratePct: 0.02 },
    { timestamp: t + 9 * 3600000, ratePct: 0.01 }, { timestamp: t + 13 * 3600000, ratePct: -0.04 },
  ] };
  const rates = normalizedSettledRates(entry);
  assert.deepEqual(rates.map(point => point.ratePct), [0.02, 0.08, -0.08]);
  assert.deepEqual(rates.map(point => point.periodSeconds), [28800, 3600, 14400]);
  assert.equal(rates.length, 3); // First event cannot infer a period.
  assert.throws(() => normalizedSettledRates({ points: [
    { timestamp: t, ratePct: 0.01 }, { timestamp: t, ratePct: 0.02 },
  ] }), /Conflicting/);
});

test("mean/median settled plots have no historical OI weights, lookahead or endless carry-forward", () => {
  const start = 1800000000;
  const entry = { points: [
    { timestamp: start * 1000, ratePct: 0.01 },
    { timestamp: (start + 3600) * 1000, ratePct: 0.02 },
  ] };
  const result = settledFundingChart([entry], start, start + 5 * 3600, "1h");
  assert.equal(result[0].meanPct, null);
  assert.equal(result[1].meanPct, 0.16);
  assert.equal(result.at(-1).meanPct, null);
  assert.ok(result.every(point => !("weightedPct" in point)));
});

test("recorded live chart does not backfill pre-tracking history and preserves observation gaps", () => {
  const start = 1800000000;
  const input = [0, 3600 * 4].map(offset => ({ time: start + offset, meanPct: 0.01,
    medianPct: 0.01, weightedPct: 0.05, weightedFallback: false, sourceCount: 2 }));
  const result = recordedFundingChart(input, start - 86400, start + 3600 * 5, "1h");
  assert.equal(result.length, 3);
  assert.equal(result[0].time, start);
  assert.equal(result[1].weightedPct, null);
  assert.equal(result[2].weightedPct, 0.05);
});
