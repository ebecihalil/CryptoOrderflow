// Perp Leverage Estimation, in real leverage units (×), from raw data this
// server records itself. No exchange publishes its users' leverage, so it is
// inferred from what leverage DOES: a position at L× is liquidated when price
// moves about 1/L against it. The model:
//
// 1. Positions: every candle where open interest grows opens a long cohort and
//    a short cohort (each contract has one of each) at that candle's typical
//    price. Falling OI closes positions proportionally. Every cohort then
//    remembers the worst move price has made against it since it was opened.
// 2. Leverage spread: each side's positions have log-normally distributed
//    leverage around a median M (most positions between M/2 and 2M). With
//    maintenance margin, a position at L× is gone once the adverse move reaches
//    1/L - mm. So for any M the model predicts how much should have been
//    liquidated in every candle.
// 3. Calibration: for each candle, M is the value whose predicted liquidations
//    best match the REAL long (or short) liquidations of the last `window`
//    candles in which the liquidation feeds were connected, pulled gently toward
//    a prior when there is little evidence (no adverse moves, no liquidations).
// 4. Prior: a typical median of 12× tilted by funding (longs pay = crowded,
//    more leveraged longs), perp vs spot volume (speculative activity vs real
//    money, from the footprint/CVD trade records) and which side's takers
//    built the recent open interest (perp CVD).
// 5. Output: notional / margin for each side (the real "average leverage" of a
//    log-normal book is M·e^(−σ²/2)); the average is the OI-weighted harmonic
//    mean of both sides (equal notional on each side).
//
// Strict completeness: an exchange counts in a candle only with open interest
// at the candle and the one before, perpetual trades in the candle and its
// liquidation feed connected for the whole candle. Spot volume is market-wide
// context for the prior only.
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { bucketStart } from "./timeframes.js";

export const PERP_LEVERAGE_FRAMES = ["5m", "15m", "30m", "1h", "4h", "24h"];
export const PERP_LEVERAGE_DEFAULTS = {
  sigma: 0.75,            // log-normal spread of leverage across positions
  maintenance: 0.005,     // maintenance margin (0.5%)
  maxLeverage: 100,       // exchanges cap leverage: no position is above this
  priorMedian: 12,        // prior median leverage (×)
  priorStrength: 1.5,     // how hard the prior pulls (in log units²)
  window: 96,             // candles of liquidation evidence used per estimate
  maxCohorts: 400,
};
const GRID = Array.from({ length: 56 }, (_, i) => 1.2 * Math.pow(100 / 1.2, i / 55)); // median 1.2× … 100×
const OI_TOLERANCE_MS = 15 * 60_000;
const LIQ_EXCHANGES = ["binance", "bybit", "okx", "deribit"];

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
// Standard normal CDF (Abramowitz-Stegun 7.1.26, |error| < 1.5e-7).
function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
/** Share of positions already liquidated once price has moved `move` (fraction) against them. */
export function liquidatedShare(move, medianLeverage, sigma, maintenance, maxLeverage = PERP_LEVERAGE_DEFAULTS.maxLeverage) {
  if (!(move > 0)) return 0;
  // Liquidated when 1/L − mm ≤ move  ⇔  L ≥ 1/(move + mm); leverage is capped at maxLeverage.
  const threshold = 1 / (move + maintenance);
  if (threshold >= maxLeverage) return 0;
  const top = normCdf((Math.log(maxLeverage) - Math.log(medianLeverage)) / sigma);
  return top > 0 ? (top - normCdf((Math.log(threshold) - Math.log(medianLeverage)) / sigma)) / top : 0;
}
/** Notional / margin of a capped log-normal leverage book: 1 / E[1/L | L ≤ max]. */
export function effectiveLeverage(medianLeverage, sigma, maxLeverage = PERP_LEVERAGE_DEFAULTS.maxLeverage) {
  const z = (Math.log(maxLeverage) - Math.log(medianLeverage)) / sigma;
  return medianLeverage * Math.exp(-sigma * sigma / 2) * normCdf(z) / Math.max(1e-12, normCdf(z + sigma));
}

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

function oiAt(points, timeMs) {
  let found = null;
  for (const point of points) {
    if (point.timestamp > timeMs) break;
    found = point;
  }
  return found && timeMs - found.timestamp <= OI_TOLERANCE_MS ? found.oiCoin : null;
}
const covered = (spans, fromMs, toMs) => (spans ?? []).some(([from, to]) => from <= fromMs + 60_000 && to >= toMs - 60_000);

/**
 * @param candles chart candles [{time (s), open, high, low, close}]
 * @param spotMinutes / perpMinutes recorded minutes with byExchange {exchange: [buyUsd, sellUsd]}
 * @param oiContracts [{exchange, points: [{timestamp (ms), oiCoin}]}]
 * @param liquidations [{exchange, side: 'long'|'short', time (ms), usd}]
 * @param coverage {exchange: [[fromMs, toMs], ...]} when each liquidation feed was connected
 * @param funding [{time (s), meanPct}] funding per candle (8h-normalised percent), optional
 */
export function buildPerpLeverage({ timeframe, candles, spotMinutes = [], perpMinutes, oiContracts, liquidations = [], coverage = {}, funding = [], settings = {} }) {
  const cfg = { ...PERP_LEVERAGE_DEFAULTS, ...settings };
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
      if (value === null) return null;
      total += value;
    }
    return total;
  };
  const step = candles.length > 1 ? candles[1].time - candles[0].time : 3600;
  const liqByCandle = new Map();
  for (const event of liquidations) {
    const time = bucketStart(timeframe, Math.floor(event.time / 1000));
    const row = liqByCandle.get(time) ?? new Map();
    const value = row.get(event.exchange) ?? { long: 0, short: 0 };
    value[event.side] += event.usd;
    row.set(event.exchange, value);
    liqByCandle.set(time, row);
  }
  const fundingAt = new Map(funding.filter(point => Number.isFinite(point?.meanPct)).map(point => [point.time, point.meanPct]));

  // ---- 1. per-candle inputs (strict cohort) ----
  const bars = [];
  for (const candle of candles) {
    const startMs = candle.time * 1000, endMs = (candle.time + step) * 1000;
    const perpRow = perp.get(candle.time), spotRow = spot.get(candle.time);
    const cohort = [];
    for (const exchange of LIQ_EXCHANGES) {
      if (!oiByExchange.has(exchange)) continue;
      const oiNow = oiOf(exchange, endMs), oiBefore = oiOf(exchange, startMs);
      const flow = perpRow?.get(exchange);
      if (oiNow === null || oiBefore === null || !flow || flow[0] + flow[1] <= 0 || !covered(coverage[exchange], startMs, endMs)) continue;
      cohort.push({ exchange, oiNow, oiBefore, flow, liq: liqByCandle.get(candle.time)?.get(exchange) ?? { long: 0, short: 0 } });
    }
    const spotUsd = [...(spotRow?.values() ?? [])].reduce((sum, [b, s]) => sum + b + s, 0);
    const price = candle.close;
    if (!cohort.length || !(price > 0)) { bars.push({ time: candle.time, candle, ok: false }); continue; }
    const sum = pick => cohort.reduce((total, item) => total + pick(item), 0);
    bars.push({
      time: candle.time, candle, ok: true, exchanges: cohort.map(item => item.exchange),
      oiNow: sum(item => item.oiNow), oiBefore: sum(item => item.oiBefore),
      buy: sum(item => item.flow[0]), sell: sum(item => item.flow[1]), spotUsd,
      liqLong: sum(item => item.liq.long), liqShort: sum(item => item.liq.short), funding: fundingAt.get(candle.time) ?? null,
    });
  }

  // ---- 2. cohorts and predicted liquidations for every leverage on the grid ----
  // cohorts: {entry, size (coins), long: worst adverse move for longs, short: same for shorts}
  const cohorts = [];
  const predicted = { long: bars.map(() => new Float64Array(GRID.length)), short: bars.map(() => new Float64Array(GRID.length)) };
  const logGrid = GRID.map(Math.log);
  const logMax = Math.log(cfg.maxLeverage);
  const tops = logGrid.map(lg => normCdf((logMax - lg) / cfg.sigma));
  const shares = (move, out) => {
    const logThreshold = -Math.log(move + cfg.maintenance);
    for (let g = 0; g < GRID.length; g++) {
      out[g] = logThreshold >= logMax || tops[g] <= 0 ? 0 : (tops[g] - normCdf((logThreshold - logGrid[g]) / cfg.sigma)) / tops[g];
    }
    return out;
  };
  const after = new Float64Array(GRID.length);
  const newCohort = (entry, size) => ({ entry, size, long: 0, short: 0, longShares: new Float64Array(GRID.length), shortShares: new Float64Array(GRID.length) });
  let carried = null;
  bars.forEach((bar, index) => {
    if (!bar.ok) return;
    const { high, low, close } = bar.candle;
    // The tracked exchange set can change: rescale cohorts to this candle's opening OI.
    if (carried !== null && carried > 0) {
      const scale = bar.oiBefore / carried;
      for (const cohort of cohorts) cohort.size *= scale;
    }
    // Adverse moves inside this candle → liquidations (USD at the touched price).
    for (const cohort of cohorts) {
      const longMove = Math.max(cohort.long, (cohort.entry - low) / cohort.entry);
      const shortMove = Math.max(cohort.short, (high - cohort.entry) / cohort.entry);
      if (longMove > cohort.long + 1e-6) {
        shares(longMove, after);
        const usd = cohort.size * low, out = predicted.long[index], prev = cohort.longShares;
        for (let g = 0; g < GRID.length; g++) { out[g] += usd * (after[g] - prev[g]); prev[g] = after[g]; }
        cohort.long = longMove;
      }
      if (shortMove > cohort.short + 1e-6) {
        shares(shortMove, after);
        const usd = cohort.size * high, out = predicted.short[index], prev = cohort.shortShares;
        for (let g = 0; g < GRID.length; g++) { out[g] += usd * (after[g] - prev[g]); prev[g] = after[g]; }
        cohort.short = shortMove;
      }
    }
    // Open interest change: new cohort, or proportional closing.
    const change = bar.oiNow - bar.oiBefore;
    if (change > 0) cohorts.push(newCohort((high + low + close) / 3, change));
    else if (change < 0) {
      const total = cohorts.reduce((s, c) => s + c.size, 0);
      const keep = total > 0 ? Math.max(0, 1 + change / total) : 0;
      for (const cohort of cohorts) cohort.size *= keep;
    }
    // Positions older than the tracked history are folded into a neutral cohort at the current price.
    const tracked = cohorts.reduce((s, c) => s + c.size, 0);
    if (bar.oiNow > tracked * 1.0001) cohorts.push(newCohort(close, bar.oiNow - tracked));
    while (cohorts.length > cfg.maxCohorts) { const old = cohorts.shift(); cohorts[0].size += old.size; }
    carried = bar.oiNow;
  });

  // ---- 3. prior per candle (funding, perp vs spot, taker side) ----
  const activity = bars.map(bar => bar.ok && bar.spotUsd > 0 ? (bar.buy + bar.sell) / bar.spotUsd : null);
  const priors = bars.map((bar, index) => {
    if (!bar.ok) return null;
    const recent = bars.slice(Math.max(0, index - 199), index + 1);
    const activityMedian = median(recent.map((_, k) => activity[Math.max(0, index - 199) + k]));
    const activityTilt = activity[index] && activityMedian ? clamp(Math.pow(activity[index] / activityMedian, 0.25), 0.6, 1.6) : 1;
    // Who built the open interest over the last 24 candles (taker buy share, OI-growth weighted).
    let weight = 0, buyShare = 0;
    for (const item of bars.slice(Math.max(0, index - 23), index + 1)) {
      if (!item.ok) continue;
      const grow = Math.max(0, item.oiNow - item.oiBefore);
      if (grow > 0 && item.buy + item.sell > 0) { weight += grow; buyShare += grow * item.buy / (item.buy + item.sell); }
    }
    const takerTilt = weight > 0 ? clamp((buyShare / weight - 0.5) * 0.8, -0.3, 0.3) : 0;
    // Funding (8h %): 0.01% is neutral; +0.03% means longs crowded and more leveraged.
    const fundingTilt = bar.funding === null ? 0 : clamp((bar.funding - 0.01) / 0.02, -2, 2) * 0.15;
    const base = cfg.priorMedian * activityTilt;
    return { long: base * Math.exp(fundingTilt + takerTilt), short: base * Math.exp(-fundingTilt - takerTilt) };
  });

  // ---- 4. fit the median leverage to the real liquidations ----
  const fitSide = side => {
    const out = new Array(bars.length).fill(null);
    for (let index = 0; index < bars.length; index++) {
      if (!bars[index].ok || !priors[index]) continue;
      const prior = Math.log(priors[index][side]);
      let best = null, bestScore = Infinity;
      for (let g = 0; g < GRID.length; g++) {
        let score = cfg.priorStrength * (Math.log(GRID[g]) - prior) ** 2;
        for (let k = Math.max(0, index - cfg.window + 1); k <= index; k++) {
          const bar = bars[k];
          if (!bar.ok) continue;
          // Noise floor: 5 bps of open interest (USD) — feeds are sampled, small mismatches don't matter.
          const floor = Math.max(1, bar.oiNow * bar.candle.close * 0.0005);
          const observed = side === "long" ? bar.liqLong : bar.liqShort;
          score += (Math.log1p(predicted[side][k][g] / floor) - Math.log1p(observed / floor)) ** 2;
        }
        if (score < bestScore) { bestScore = score; best = GRID[g]; }
      }
      out[index] = best;
    }
    return out;
  };
  const longMedian = fitSide("long"), shortMedian = fitSide("short");

  // ---- 5. output in × (notional / margin), lightly smoothed ----
  const smooth = values => {
    let previous = null;
    return values.map(value => {
      if (value === null) { previous = null; return null; }
      previous = previous === null ? value : previous + 0.5 * (value - previous);
      return previous;
    });
  };
  const longLev = smooth(longMedian.map(m => m === null ? null : effectiveLeverage(m, cfg.sigma, cfg.maxLeverage)));
  const shortLev = smooth(shortMedian.map(m => m === null ? null : effectiveLeverage(m, cfg.sigma, cfg.maxLeverage)));
  const round = value => value === null ? null : Math.round(clamp(value, 1, 125) * 10) / 10;
  return bars.map((bar, index) => {
    const long = longLev[index], short = shortLev[index];
    const avg = long === null || short === null ? null : 2 / (1 / long + 1 / short);
    return { time: bar.time, avg: round(avg), long: round(long), short: round(short), exchanges: bar.exchanges ?? [],
      liqLongUsd: bar.liqLong ?? null, liqShortUsd: bar.liqShort ?? null };
  });
}

export function createPerpLeverageService({ cvd, oiInputs, candles: candleSource, oiExchanges, funding = null }) {
  const cache = new Map();
  async function get(query) {
    const asset = typeof query.asset === "string" ? canonicalAsset(query.asset.trim().toUpperCase()).asset : "";
    const timeframe = query.timeframe ?? "1h";
    if (!/^[A-Z0-9]{1,30}$/.test(asset) || !isCryptoAsset(asset) || !PERP_LEVERAGE_FRAMES.includes(timeframe) ||
      typeof query.exchange !== "string" || typeof query.symbol !== "string")
      throw Object.assign(new Error("A crypto asset, chart exchange/symbol and a timeframe of 5m, 15m, 30m, 1h, 4h or 1D are required."), { status: 400 });
    const key = `${asset}:${timeframe}:${query.exchange}:${query.symbol}`, hit = cache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    const price = await candleSource.get({ exchange: query.exchange, symbol: query.symbol, timeframe });
    const spotMinutes = cvd.flowMinutes(asset, "spot"), perpMinutes = cvd.flowMinutes(asset, "perpetual");
    const oi = oiInputs(asset, oiExchanges);
    const oiContracts = oi.contracts.map(contract => ({ exchange: contract.exchange ?? String(contract.key).split(":")[0], points: contract.points }));
    const liquidation = cvd.liquidationSnapshot(asset);
    let fundingPoints = [];
    try { fundingPoints = funding?.get({ asset, timeframe, window: "7d" })?.history?.points ?? []; } catch { fundingPoints = []; }
    const rows = buildPerpLeverage({ timeframe, candles: price.candles ?? [], spotMinutes, perpMinutes, oiContracts,
      liquidations: liquidation.events, coverage: liquidation.spans ?? {}, funding: fundingPoints });
    const used = new Set(rows.flatMap(row => row.exchanges ?? []));
    const value = { asset, timeframe, unit: "x",
      rows: rows.map(({ time, avg, long, short, exchanges }) => ({ time, avg, long, short, exchanges })),
      exchangesUsed: [...used].sort(), settings: PERP_LEVERAGE_DEFAULTS, generatedAt: new Date().toISOString() };
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return value;
  }
  return { get };
}
