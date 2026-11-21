// Long/Short Account Ratio as a Super Charts pane: one aggregated ratio per
// candle across exchanges, weighted by each contract's USD open interest (as on
// the LSAR pages). Global = all accounts; Top = top-trader accounts.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalAsset } from "./assetIdentity.js";
import { RECORD_DAYS } from "./retention.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { bucketStart, nextBucket as nextBucketStart } from "./timeframes.js";
import { getLsarChartReadings } from "./lsarMarketData.js";
import { getTopTraderLsarChartReadings } from "./topTraderLsarMarketData.js";

/** Exchanges publish 5-minute (about a day) and hourly (about 12 days) history. */
export const LSAR_CHART_FRAMES = ["5m", "15m", "30m", "1h", "4h", "24h"];
/** Show a candle only when exchanges covering this share of OI have a reading (avoids jumps). */
const MIN_WEIGHT_SHARE = 0.8;

export function buildLsarSeries(readings, timeframe, nowSeconds = Date.now() / 1000) {
  if (!LSAR_CHART_FRAMES.includes(timeframe)) throw new Error("Unsupported LSAR timeframe.");
  const hourly = ["1h", "4h", "24h"].includes(timeframe);
  // Each exchange's latest reading stays valid for this long, so a candle (including the current
  // one) uses every exchange's most recent value instead of waiting for all of them to publish.
  const maxAge = hourly ? 2 * 3600 : 30 * 60;
  const series = readings.map(reading => {
    const points = (hourly && reading.longWindowPoints?.length ? reading.longWindowPoints : reading.points) ?? [];
    const timeline = [...points].filter(point => point.ratio > 0 && Number.isFinite(point.timestamp))
      .map(point => ({ time: Math.floor(point.timestamp / 1000), ratio: point.ratio })).sort((a, b) => a.time - b.time);
    return { exchange: reading.exchange, symbol: reading.symbol, weight: reading.openInterestUsd > 0 ? reading.openInterestUsd : 0, timeline };
  }).filter(item => item.weight > 0 && item.timeline.length);
  const total = series.reduce((sum, item) => sum + item.weight, 0);
  const buckets = new Set(series.flatMap(item => item.timeline.map(point => bucketStart(timeframe, point.time))));
  if (series.length) buckets.add(bucketStart(timeframe, Math.floor(nowSeconds)));
  const times = [...buckets].sort((a, b) => a - b);
  const index = series.map(() => -1);
  const points = [];
  for (const time of times) {
    const end = Math.min(nextBucketStart(timeframe, time), Math.floor(nowSeconds) + 1);
    let weight = 0, longWeighted = 0, count = 0;
    series.forEach((item, k) => {
      while (index[k] + 1 < item.timeline.length && item.timeline[index[k] + 1].time < end) index[k]++;
      const reading = item.timeline[index[k]];
      if (!reading || end - reading.time > maxAge + (end - time)) return; // too old for this candle
      weight += item.weight; longWeighted += item.weight * (reading.ratio / (1 + reading.ratio)); count++;
    });
    if (!weight || weight < total * MIN_WEIGHT_SHARE) continue;
    const longShare = longWeighted / weight;
    points.push({ time, ratio: Math.round(longShare / (1 - longShare) * 10000) / 10000,
      longPct: Math.round(longShare * 10000) / 100, sources: count });
  }
  return { points, sources: series.map(({ exchange, symbol, weight }) => ({ exchange, symbol, oiUsd: weight })) };
}

// 30-day memory: every computed 5-minute and hourly point is saved (exchanges only
// publish about 12 days), so the chart keeps growing instead of dropping old candles.
const LONG_MS = RECORD_DAYS * 86400_000;
const longDirectory = process.env.LSAR_HISTORY_DIR ?? fileURLToPath(new URL("../.cache/lsar-long/", import.meta.url));
const stores = new Map(); // `${asset}:${kind}` -> {"5m": Map(time -> point), "1h": Map}
function storeFor(asset, kind, directory) {
  const key = `${asset}:${kind}`;
  if (stores.has(key)) return stores.get(key);
  const store = { "5m": new Map(), "1h": new Map() };
  if (directory) {
    try {
      const saved = JSON.parse(readFileSync(join(directory, `${asset}-${kind}.json`), "utf8"));
      for (const base of ["5m", "1h"]) for (const point of saved?.[base] ?? []) {
        if (Number.isFinite(point?.time) && point.ratio > 0 && Number.isFinite(point.longPct)) store[base].set(point.time, point);
      }
    } catch { /* first time */ }
  }
  stores.set(key, store);
  return store;
}
/** Merge freshly computed points into the saved history and return it aggregated to `timeframe`. */
export function mergeLsarHistory(store, fresh, timeframe, nowMs = Date.now()) {
  const cutoff = (nowMs - LONG_MS) / 1000;
  for (const base of ["5m", "1h"]) {
    for (const point of fresh[base] ?? []) store[base].set(point.time, point);
    for (const time of store[base].keys()) if (time < cutoff) store[base].delete(time);
  }
  const base = ["1h", "4h", "24h"].includes(timeframe) ? "1h" : "5m";
  const byBucket = new Map();
  for (const point of [...store[base].values()].sort((a, b) => a.time - b.time)) {
    byBucket.set(bucketStart(timeframe, point.time), point); // last reading in the candle
  }
  return [...byBucket].map(([time, point]) => ({ ...point, time })).sort((a, b) => a.time - b.time);
}

export function getLsarChart(query, { globalReadings = getLsarChartReadings, topReadings = getTopTraderLsarChartReadings, directory = longDirectory, now = Date.now } = {}) {
  const asset = typeof query.asset === "string" ? canonicalAsset(query.asset.trim().toUpperCase()).asset : "";
  const kind = query.kind ?? "global", timeframe = query.timeframe ?? "1h";
  if (!/^[A-Z0-9]{1,30}$/.test(asset) || !isCryptoAsset(asset) || !["global", "top"].includes(kind) || !LSAR_CHART_FRAMES.includes(timeframe))
    throw Object.assign(new Error("A crypto asset, kind global or top, and a timeframe of 5m, 15m, 30m, 1h, 4h or 1D are required."), { status: 400 });
  const readings = kind === "top" ? topReadings(asset) : globalReadings(asset);
  const fresh = { "5m": buildLsarSeries(readings, "5m").points, "1h": buildLsarSeries(readings, "1h").points };
  const store = storeFor(asset, kind, directory);
  const points = mergeLsarHistory(store, fresh, timeframe, now());
  if (directory && (fresh["5m"].length || fresh["1h"].length)) {
    try {
      mkdirSync(directory, { recursive: true });
      const file = join(directory, `${asset}-${kind}.json`);
      writeFileSync(`${file}.tmp`, JSON.stringify({ "5m": [...store["5m"].values()], "1h": [...store["1h"].values()] }));
      renameSync(`${file}.tmp`, file);
    } catch { /* kept in memory; saved next time */ }
  }
  return { asset, kind, timeframe, points, sources: buildLsarSeries(readings, timeframe).sources, generatedAt: new Date(now()).toISOString() };
}
