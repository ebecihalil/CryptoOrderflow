// Adapted from the user's Pine v6 "Multi-Exchange Aggregated Funding Rate".
// Percentage values stay percentages throughout; OI weights are verified USD.
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { FUNDING_LABELS, normalizedRate } from "./fundingMath.js";

import { CHART_TIMEFRAMES, bucketStart, nextBucket, timeframeSeconds } from "./timeframes.js";
export const INDICATOR_STEPS = Object.fromEntries(CHART_TIMEFRAMES.map(tf => [tf, timeframeSeconds(tf)]));
const firstBucketFrom = (timeframe, from) => {
  const start = bucketStart(timeframe, from);
  return start < from ? nextBucket(timeframe, start) : start;
};
export const INDICATOR_WINDOWS = { "1d": 86400, "7d": 604800, "30d": 2592000, "90d": 7776000, "120d": 10368000 };
const finite = value => typeof value === "number" && Number.isFinite(value);

export function validateFundingIndicatorQuery(query = {}) {
  let asset = query.asset ?? "BTC";
  const timeframe = query.timeframe ?? "1h", window = query.window ?? "7d";
  if (typeof asset !== "string" || typeof timeframe !== "string" || typeof window !== "string" ||
    !Object.hasOwn(INDICATOR_STEPS, timeframe) || !Object.hasOwn(INDICATOR_WINDOWS, window)) {
    throw Object.assign(new Error("Choose a crypto asset, supported timeframe and history window."), { status: 400 });
  }
  asset = asset.trim().toUpperCase().replace(/\.P$/, "").replace(/USDT$/, "");
  if (!/^[A-Z0-9]{2,30}$/.test(asset)) throw Object.assign(new Error("Enter a supported crypto ticker."), { status: 400 });
  asset = ({ XBT: "BTC", XDG: "DOGE" })[asset] ?? canonicalAsset(asset).asset;
  if (!isCryptoAsset(asset)) throw Object.assign(new Error("This asset is not a verified cryptocurrency."), { status: 400 });
  return { asset, timeframe, window };
}

export function aggregateFundingRates(readings) {
  const valid = readings.filter(item => finite(item.ratePct));
  const sorted = valid.map(item => item.ratePct).sort((a, b) => a - b);
  if (!sorted.length) return { meanPct: null, medianPct: null, weightedPct: null, weightedFallback: false, sourceCount: 0, totalOiUsd: 0 };
  const meanPct = sorted.reduce((sum, rate) => sum + rate, 0) / sorted.length;
  const mid = Math.floor(sorted.length / 2);
  const medianPct = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const weights = valid.map(item => finite(item.oiUsd) ? Math.max(0, item.oiUsd) : 0);
  const totalOiUsd = weights.reduce((sum, weight) => sum + weight, 0);
  const weightedPct = totalOiUsd > 0
    ? valid.reduce((sum, item, index) => sum + item.ratePct * weights[index], 0) / totalOiUsd : meanPct;
  return { meanPct, medianPct, weightedPct, weightedFallback: totalOiUsd === 0, sourceCount: valid.length, totalOiUsd };
}

/** One contract per exchange prevents multiple listings overweighting a mean. */
export function selectFundingIndicatorSources(inventory, asset, now = Date.now()) {
  const sources = Object.entries(inventory).map(([exchange, state]) => {
    const candidates = state.readings.filter(item => item.asset === asset && finite(item.oiUsd) && item.oiUsd >= 0);
    const valid = candidates.filter(item => finite(item.ratePct) && finite(item.intervalHours) && item.intervalHours > 0);
    const freshValid = valid.filter(item => finite(item.fetchedAt) && now - item.fetchedAt <= 900_000 && item.fetchedAt <= now + 60_000);
    const item = [...(freshValid.length ? freshValid : valid.length ? valid : candidates)]
      .sort((a, b) => b.oiUsd - a.oiUsd || a.symbol.localeCompare(b.symbol))[0];
    const fresh = item && finite(item.fetchedAt) && now - item.fetchedAt <= 900_000 && item.fetchedAt <= now + 60_000;
    const ratePct = fresh && finite(item.ratePct) ? normalizedRate(item.ratePct, item.intervalHours) : null;
    return {
      exchange, label: FUNDING_LABELS[exchange] ?? exchange, symbol: item?.symbol ?? null,
      status: finite(ratePct) ? "ok" : state.running ? "loading" : "unavailable",
      ratePct: finite(ratePct) ? ratePct : null, nativeRatePct: fresh ? item.ratePct : null,
      intervalHours: item?.intervalHours ?? null, oiUsd: fresh ? item.oiUsd : null,
      fetchedAt: item && finite(item.fetchedAt) ? new Date(item.fetchedAt).toISOString() : null, item,
    };
  });
  const priorities = { binance: 0, bybit: 1, okx: 2, gate: 3 };
  return sources.sort((a, b) => (priorities[a.exchange] ?? 4) - (priorities[b.exchange] ?? 4) ||
    (b.oiUsd ?? 0) - (a.oiUsd ?? 0) || a.label.localeCompare(b.label));
}

/** Payment frequency may change: never apply today's interval to past payments. */
export function normalizedSettledRates(entry) {
  const byTime = new Map();
  for (const point of entry?.points ?? []) {
    if (!finite(point.timestamp) || !finite(point.ratePct)) continue;
    if (byTime.has(point.timestamp) && byTime.get(point.timestamp).ratePct !== point.ratePct) {
      throw new Error("Conflicting settled payment records.");
    }
    byTime.set(point.timestamp, point);
  }
  const payments = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
  const periods = [0.25, 0.5, 1, 2, 4, 6, 8, 12, 24];
  const result = [];
  for (let i = 1; i < payments.length; i++) {
    const hours = (payments[i].timestamp - payments[i - 1].timestamp) / 3_600_000;
    const period = periods.find(value => Math.abs(value - hours) <= 1 / 60);
    if (!period) continue; // Unknown frequency / irregular gap: no fabricated rate.
    result.push({ time: Math.floor(payments[i].timestamp / 1000), ratePct: payments[i].ratePct * 8 / period,
      periodSeconds: period * 3600 });
  }
  return result;
}

/**
 * Latest known settled rate at each UTC bar, not historical funding forecasts.
 * Entries are settled-payment histories, optionally tagged `{entry, exchange, oiUsd}`.
 * OI-weighted values use each exchange's open interest AT THAT TIME (coins, from the
 * recorded long OI history, `oiAt(exchange, seconds)`); when that is missing for any
 * contributing exchange the bar uses today's OI shares instead (`oiUsd`).
 * `live` (the current snapshot) replaces the newest bar, so the line ends at the live rate.
 */
export function settledFundingChart(entries, from, to, timeframe, { oiAt = null, live = null } = {}) {
  const tagged = entries.map(item => item?.entry ? item : { entry: item, exchange: null, oiUsd: null });
  const series = tagged.map(item => ({ ...item, points: normalizedSettledRates(item.entry) })).filter(item => item.points.length);
  if (!series.length && !live) return [];
  const indices = series.map(() => -1), result = [];
  const lastBucket = bucketStart(timeframe, to);
  for (let time = firstBucketFrom(timeframe, from); time <= to; time = nextBucket(timeframe, time)) {
    if (time === lastBucket && live && live.sourceCount > 0) {
      result.push({ time, meanPct: live.meanPct, medianPct: live.medianPct, weightedPct: live.weightedPct ?? live.meanPct,
        sourceCount: live.sourceCount, live: true });
      continue;
    }
    const rates = [];
    series.forEach((item, index) => {
      const points = item.points;
      while (indices[index] + 1 < points.length && points[indices[index] + 1].time <= time) indices[index]++;
      const point = points[indices[index]];
      if (point && time - point.time <= point.periodSeconds + 60) rates.push({ ratePct: point.ratePct, exchange: item.exchange, oiUsd: item.oiUsd });
    });
    const values = aggregateFundingRates(rates);
    let weightedPct = null;
    if (rates.length) {
      const then = oiAt ? rates.map(rate => rate.exchange ? oiAt(rate.exchange, time) : null) : [];
      const useThen = then.length === rates.length && then.every(value => finite(value) && value > 0);
      const weights = useThen ? then : rates.map(rate => finite(rate.oiUsd) && rate.oiUsd > 0 ? rate.oiUsd : 0);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      weightedPct = total > 0 ? rates.reduce((sum, rate, k) => sum + rate.ratePct * weights[k], 0) / total : values.meanPct;
    }
    result.push({ time, meanPct: values.meanPct, medianPct: values.medianPct, weightedPct, sourceCount: values.sourceCount });
  }
  return result;
}

export function recordedFundingChart(observations, from, to, timeframe) {
  const step = INDICATOR_STEPS[timeframe], buckets = new Map();
  for (const point of observations) {
    if (point.time < from || point.time > to) continue;
    buckets.set(bucketStart(timeframe, point.time), point);
  }
  const result = [];
  for (const [time, point] of [...buckets].sort((a, b) => a[0] - b[0])) {
    const previous = result.at(-1);
    if (previous && time > nextBucket(timeframe, previous.time)) result.push({ time: nextBucket(timeframe, previous.time),
      meanPct: null, medianPct: null, weightedPct: null, weightedFallback: false, sourceCount: 0 });
    result.push({ ...point, time });
  }
  return result;
}
