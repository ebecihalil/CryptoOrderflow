// Perp Leverage Estimation, built only from raw data this server records itself:
// open interest per exchange, perpetual and spot taker trades per exchange
// (footprint / CVD / volume) and liquidations. No exchange "leverage" field
// exists, so this is an estimate of how much leveraged positioning there is
// relative to real (spot) money, and how it is split between longs and shorts.
//
// Strict completeness: an exchange only counts in a candle when it has ALL of:
// open interest at the candle and the one before, perpetual trades in the
// candle, and spot trades in the candle. Exchanges with partial data are left
// out of that candle entirely, so a missing input never distorts the result.
//
// Lines (100 = this coin's normal level, its own median over the lookback):
//   orange = average leverage estimate
//   green  = long-side estimate, red = short-side estimate.
//   If longs and shorts hold the same open interest, green = red = orange.
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { bucketStart } from "./timeframes.js";

export const PERP_LEVERAGE_FRAMES = ["5m", "15m", "30m", "1h", "4h", "24h"];
export const PERP_LEVERAGE_DEFAULTS = { maLength: 20, lookback: 200, oiWeight: 0.7, minShare: 0.02 };
const OI_TOLERANCE_MS = 15 * 60_000;

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Sum per-exchange [buy, sell] USD of recorded minutes into chart candles. */
export function flowsByCandle(minutes, timeframe) {
  const candles = new Map();
  for (const minute of minutes) {
    if (!minute?.byExchange) continue;
    const time = bucketStart(timeframe, minute.time);
    if (!candles.has(time)) candles.set(time, new Map());
    const bucket = candles.get(time);
    for (const [exchange, [buy, sell]] of Object.entries(minute.byExchange)) {
      const row = bucket.get(exchange) ?? [0, 0];
      row[0] += buy; row[1] += sell;
      bucket.set(exchange, row);
    }
  }
  return candles;
}

/** Open interest (coins) per exchange at a time: last point at or before it, if recent enough. */
function oiAt(points, timeMs) {
  let found = null;
  for (const point of points) {
    if (point.timestamp > timeMs) break;
    found = point;
  }
  return found && timeMs - found.timestamp <= OI_TOLERANCE_MS ? found.oiCoin : null;
}

/**
 * @param candles chart candles [{time (s), close}] (price for USD values)
 * @param spotMinutes / perpMinutes recorded minutes with byExchange {exchange: [buyUsd, sellUsd]}
 * @param oiContracts [{exchange, points: [{timestamp (ms), oiCoin}]}] (summed per exchange)
 * @param liquidations [{exchange, side: 'long'|'short', time (ms), usd}]
 */
export function buildPerpLeverage({ timeframe, candles, spotMinutes, perpMinutes, oiContracts, liquidations = [], settings = {} }) {
  const { maLength, lookback, oiWeight, minShare } = { ...PERP_LEVERAGE_DEFAULTS, ...settings };
  const spot = flowsByCandle(spotMinutes, timeframe), perp = flowsByCandle(perpMinutes, timeframe);
  const oiByExchange = new Map();
  for (const contract of oiContracts) {
    const list = oiByExchange.get(contract.exchange) ?? [];
    list.push([...contract.points].sort((a, b) => a.timestamp - b.timestamp));
    oiByExchange.set(contract.exchange, list);
  }
  const oiOf = (exchange, timeMs) => {
    const lists = oiByExchange.get(exchange);
    if (!lists) return null;
    let total = 0;
    for (const points of lists) {
      const value = oiAt(points, timeMs);
      if (value === null) return null; // every contract of the exchange must have a reading
      total += value;
    }
    return total;
  };
  const step = (candles.length > 1 ? candles[1].time - candles[0].time : 3600);
  const liqByCandle = new Map();
  for (const event of liquidations) {
    const time = bucketStart(timeframe, Math.floor(event.time / 1000));
    const row = liqByCandle.get(time) ?? new Map();
    const value = row.get(event.exchange) ?? { long: 0, short: 0 };
    value[event.side] += event.usd;
    row.set(event.exchange, value);
    liqByCandle.set(time, row);
  }

  // Per-exchange rolling spot volume (only candles where that exchange had spot trades).
  const spotHistory = new Map();
  const rows = [];
  let longCoins = null, shortCoins = null;
  for (const candle of candles) {
    const price = candle.close;
    const endMs = (candle.time + step) * 1000;
    const spotRow = spot.get(candle.time), perpRow = perp.get(candle.time);
    for (const [exchange, [buy, sell]] of spotRow ?? []) {
      const list = spotHistory.get(exchange) ?? [];
      list.push(buy + sell); if (list.length > maLength) list.shift();
      spotHistory.set(exchange, list);
    }
    const cohort = [];
    for (const exchange of oiByExchange.keys()) {
      const oiNow = oiOf(exchange, endMs), oiBefore = oiOf(exchange, endMs - step * 1000);
      const perpFlow = perpRow?.get(exchange), spotFlow = spotRow?.get(exchange);
      if (oiNow === null || oiBefore === null || !perpFlow || perpFlow[0] + perpFlow[1] <= 0 ||
        !spotFlow || spotFlow[0] + spotFlow[1] <= 0) continue;
      const spotList = spotHistory.get(exchange);
      cohort.push({ exchange, oiNow, oiBefore, perpFlow, spotAverage: spotList.reduce((a, b) => a + b, 0) / spotList.length });
    }
    if (!cohort.length || !(price > 0)) {
      rows.push({ time: candle.time, avg: null, long: null, short: null, exchanges: [] });
      continue;
    }
    const oiCoins = cohort.reduce((sum, item) => sum + item.oiNow, 0);
    const oiBeforeCoins = cohort.reduce((sum, item) => sum + item.oiBefore, 0);
    const buy = cohort.reduce((sum, item) => sum + item.perpFlow[0], 0), sell = cohort.reduce((sum, item) => sum + item.perpFlow[1], 0);
    const spotAverage = cohort.reduce((sum, item) => sum + item.spotAverage, 0);
    const spotNow = cohort.reduce((sum, item) => { const flow = spotRow.get(item.exchange); return sum + flow[0] + flow[1]; }, 0);
    const liq = { long: 0, short: 0 };
    for (const item of cohort) {
      const value = liqByCandle.get(candle.time)?.get(item.exchange);
      if (value) { liq.long += value.long; liq.short += value.short; }
    }
    // Long / short split of open interest (coins), carried candle to candle.
    if (longCoins === null) { longCoins = oiBeforeCoins / 2; shortCoins = oiBeforeCoins / 2; }
    else {
      // The cohort can change: rescale the carried split to this cohort's open interest.
      const carried = longCoins + shortCoins;
      if (carried > 0) { const scale = oiBeforeCoins / carried; longCoins *= scale; shortCoins *= scale; }
    }
    const buyShare = buy / (buy + sell), change = oiCoins - oiBeforeCoins;
    if (change >= 0) {
      // New positions: aggressive buyers opened longs, aggressive sellers opened shorts.
      longCoins += change * buyShare; shortCoins += change * (1 - buyShare);
    } else {
      // Closing: liquidations first (known side), the rest by who was selling (longs) or buying (shorts).
      let remaining = -change;
      const longLiq = Math.min(remaining, liq.long / price); remaining -= longLiq;
      const shortLiq = Math.min(remaining, liq.short / price); remaining -= shortLiq;
      longCoins -= longLiq + remaining * (1 - buyShare);
      shortCoins -= shortLiq + remaining * buyShare;
    }
    const floor = oiCoins * minShare;
    longCoins = Math.max(floor, longCoins); shortCoins = Math.max(floor, shortCoins);
    const scale = oiCoins / (longCoins + shortCoins);
    longCoins *= scale; shortCoins *= scale;
    const perpTurnover = buy + sell;
    rows.push({
      time: candle.time, exchanges: cohort.map(item => item.exchange),
      oiUsd: oiCoins * price, spotAverageUsd: spotAverage, spotUsd: spotNow, perpUsd: perpTurnover,
      perpDeltaUsd: buy - sell, liqLongUsd: liq.long, liqShortUsd: liq.short,
      longShare: longCoins / oiCoins,
      // Positions held vs average real spot money, and derivative vs spot activity.
      oiRatio: spotAverage > 0 ? (oiCoins * price) / spotAverage : null,
      volumeRatio: spotNow > 0 ? perpTurnover / spotNow : null,
    });
  }
  // Normalise each component to its own median over the lookback (100 = normal for this coin).
  const out = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.oiRatio === null || row.oiRatio === undefined) { out.push({ ...row, avg: null, long: null, short: null }); continue; }
    const window = rows.slice(Math.max(0, index - lookback + 1), index + 1);
    const oiMedian = median(window.map(item => item.oiRatio)), volumeMedian = median(window.map(item => item.volumeRatio));
    const oiPart = oiMedian ? row.oiRatio / oiMedian : null;
    const volumePart = volumeMedian && row.volumeRatio ? row.volumeRatio / volumeMedian : null;
    const combined = oiPart === null ? null : volumePart === null ? oiPart
      : Math.exp(oiWeight * Math.log(oiPart) + (1 - oiWeight) * Math.log(volumePart));
    const avg = combined === null ? null : Math.round(combined * 1000) / 10;
    out.push({ ...row, avg,
      long: avg === null ? null : Math.round(avg * row.longShare * 2 * 10) / 10,
      short: avg === null ? null : Math.round(avg * (1 - row.longShare) * 2 * 10) / 10 });
  }
  return out;
}

export function createPerpLeverageService({ cvd, oiInputs, candles: candleSource, oiExchanges }) {
  async function get(query) {
    const asset = typeof query.asset === "string" ? canonicalAsset(query.asset.trim().toUpperCase()).asset : "";
    const timeframe = query.timeframe ?? "1h";
    if (!/^[A-Z0-9]{1,30}$/.test(asset) || !isCryptoAsset(asset) || !PERP_LEVERAGE_FRAMES.includes(timeframe) ||
      typeof query.exchange !== "string" || typeof query.symbol !== "string")
      throw Object.assign(new Error("A crypto asset, chart exchange/symbol and a timeframe of 5m, 15m, 30m, 1h, 4h or 1D are required."), { status: 400 });
    const price = await candleSource.get({ exchange: query.exchange, symbol: query.symbol, timeframe });
    const spotMinutes = cvd.flowMinutes(asset, "spot"), perpMinutes = cvd.flowMinutes(asset, "perpetual");
    const oi = oiInputs(asset, oiExchanges);
    const oiContracts = oi.contracts.map(contract => ({ exchange: contract.exchange ?? String(contract.key).split(":")[0], points: contract.points }));
    const liquidations = cvd.liquidationSnapshot(asset).events;
    const rows = buildPerpLeverage({ timeframe, candles: price.candles ?? [], spotMinutes, perpMinutes, oiContracts, liquidations });
    const used = new Set(rows.flatMap(row => row.exchanges ?? []));
    return { asset, timeframe, rows: rows.map(({ time, avg, long, short, exchanges, longShare }) => ({ time, avg, long, short, exchanges, longShare })),
      exchangesUsed: [...used].sort(), settings: PERP_LEVERAGE_DEFAULTS, generatedAt: new Date().toISOString() };
  }
  return { get };
}
