// Aggregated Liquidations pane: long and short liquidations (USD) per chart candle from
// every exchange whose liquidation feed the server records, and what share of those
// exchanges' open interest was liquidated (the owner's "Multi-Exchange Aggregated
// Crypto Liquidations" script, without the table).
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { CHART_TIMEFRAMES, bucketStart, nextBucket } from "./timeframes.js";
import { LIQUIDATION_EXCHANGES } from "./cvdStreams.js";

const FRESH_MS = 30 * 60_000;

export function createLiquidationService({ candles: candleSource, cvd, oiInputs, now = Date.now }) {
  async function get(query) {
    const asset = typeof query.asset === "string" ? canonicalAsset(query.asset.trim().toUpperCase()).asset : "";
    const timeframe = query.timeframe ?? "1h";
    if (!/^[A-Z0-9]{1,30}$/.test(asset) || !isCryptoAsset(asset) || !CHART_TIMEFRAMES.includes(timeframe) ||
      typeof query.exchange !== "string" || typeof query.symbol !== "string")
      throw Object.assign(new Error("A crypto asset, chart contract and a timeframe from 1m to 3M are required."), { status: 400 });
    const price = await candleSource.get({ exchange: query.exchange, symbol: query.symbol, timeframe });
    // Make sure the coin's perpetual recorder (and its liquidation feeds) is running.
    try { cvd.get({ asset, market: "perpetual", timeframe: "1h", anchor: "1d" }); } catch { /* capacity busy */ }
    const snapshot = cvd.liquidationSnapshot(asset);
    const oi = oiInputs(asset, LIQUIDATION_EXCHANGES);

    const sums = new Map();
    for (const event of snapshot.events ?? []) {
      const time = bucketStart(timeframe, Math.floor(event.time / 1000));
      const row = sums.get(time) ?? { long: 0, short: 0 };
      row[event.side] += event.usd;
      sums.set(time, row);
    }
    const spans = Object.values(snapshot.spans ?? {}).flat();
    const covered = (fromMs, toMs) => spans.some(([from, to]) => from < toMs && to > fromMs);
    // Open interest (coins) of the liquidation-feed exchanges, as of each candle end.
    const series = Object.values(oi.long ?? {}).map(points => [...points].sort((a, b) => a.timestamp - b.timestamp));
    const index = series.map(() => -1);
    const liveCoins = (oi.contracts ?? []).reduce((sum, item) => sum + (Number.isFinite(item.oiCoin) ? item.oiCoin : 0), 0);
    const bars = [];
    const list = price.candles ?? [];
    list.forEach((candle, position) => {
      const endMs = nextBucket(timeframe, candle.time) * 1000;
      let coins = 0, found = false;
      series.forEach((points, k) => {
        while (index[k] + 1 < points.length && points[index[k] + 1].timestamp < endMs) index[k]++;
        const point = points[index[k]];
        if (point && endMs - point.timestamp <= FRESH_MS + (endMs - candle.time * 1000)) { coins += point.oiCoin; found = true; }
      });
      if (!found && position === list.length - 1 && liveCoins > 0) { coins = liveCoins; found = true; }
      const row = sums.get(candle.time);
      const seen = !!row || covered(candle.time * 1000, endMs);
      bars.push({ time: candle.time, longUsd: seen ? row?.long ?? 0 : null, shortUsd: seen ? row?.short ?? 0 : null,
        oiUsd: found && candle.close > 0 ? coins * candle.close : null });
    });
    return { asset, timeframe, exchanges: LIQUIDATION_EXCHANGES, bars: bars.slice(-1500), generatedAt: new Date(now()).toISOString() };
  }
  return { get };
}
