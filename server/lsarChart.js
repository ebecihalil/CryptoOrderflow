// Long/Short Account Ratio as a Super Charts pane: one aggregated ratio per
// candle across exchanges, weighted by each contract's USD open interest (as on
// the LSAR pages). Global = all accounts; Top = top-trader accounts.
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { bucketStart } from "./timeframes.js";
import { getLsarChartReadings } from "./lsarMarketData.js";
import { getTopTraderLsarChartReadings } from "./topTraderLsarMarketData.js";

/** Exchanges publish 5-minute (about a day) and hourly (about 12 days) history. */
export const LSAR_CHART_FRAMES = ["5m", "15m", "30m", "1h", "4h", "24h"];
/** Show a candle only when exchanges covering this share of OI have a reading (avoids jumps). */
const MIN_WEIGHT_SHARE = 0.8;

export function buildLsarSeries(readings, timeframe) {
  if (!LSAR_CHART_FRAMES.includes(timeframe)) throw new Error("Unsupported LSAR timeframe.");
  const hourly = ["1h", "4h", "24h"].includes(timeframe);
  const series = readings.map(reading => {
    const points = (hourly && reading.longWindowPoints?.length ? reading.longWindowPoints : reading.points) ?? [];
    const byBucket = new Map();
    for (const point of [...points].sort((a, b) => a.timestamp - b.timestamp)) {
      if (!(point.ratio > 0) || !Number.isFinite(point.timestamp)) continue;
      byBucket.set(bucketStart(timeframe, Math.floor(point.timestamp / 1000)), point.ratio); // last reading in the candle
    }
    return { exchange: reading.exchange, symbol: reading.symbol, weight: reading.openInterestUsd > 0 ? reading.openInterestUsd : 0, byBucket };
  }).filter(item => item.weight > 0 && item.byBucket.size);
  const total = series.reduce((sum, item) => sum + item.weight, 0);
  const times = [...new Set(series.flatMap(item => [...item.byBucket.keys()]))].sort((a, b) => a - b);
  const points = [];
  for (const time of times) {
    let weight = 0, longWeighted = 0, count = 0;
    for (const item of series) {
      const ratio = item.byBucket.get(time);
      if (ratio === undefined) continue;
      weight += item.weight; longWeighted += item.weight * (ratio / (1 + ratio)); count++;
    }
    if (!weight || weight < total * MIN_WEIGHT_SHARE) continue;
    const longShare = longWeighted / weight;
    points.push({ time, ratio: Math.round(longShare / (1 - longShare) * 10000) / 10000,
      longPct: Math.round(longShare * 10000) / 100, sources: count });
  }
  return { points, sources: series.map(({ exchange, symbol, weight }) => ({ exchange, symbol, oiUsd: weight })) };
}

export function getLsarChart(query, { globalReadings = getLsarChartReadings, topReadings = getTopTraderLsarChartReadings } = {}) {
  const asset = typeof query.asset === "string" ? canonicalAsset(query.asset.trim().toUpperCase()).asset : "";
  const kind = query.kind ?? "global", timeframe = query.timeframe ?? "1h";
  if (!/^[A-Z0-9]{1,30}$/.test(asset) || !isCryptoAsset(asset) || !["global", "top"].includes(kind) || !LSAR_CHART_FRAMES.includes(timeframe))
    throw Object.assign(new Error("A crypto asset, kind global or top, and a timeframe of 5m, 15m, 30m, 1h, 4h or 1D are required."), { status: 400 });
  const readings = kind === "top" ? topReadings(asset) : globalReadings(asset);
  return { asset, kind, timeframe, ...buildLsarSeries(readings, timeframe), generatedAt: new Date().toISOString() };
}
