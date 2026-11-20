// Aggregated Leverage Estimate — pure calculations (no I/O).
//
// IMPORTANT: true average leverage = notional / posted margin, and no exchange
// publishes aggregate margin. Everything here is an ESTIMATE built from data
// venues do publish:
//   1. OI / spot-turnover pressure (the TradingView script's core idea),
//      aggregated across matched venues and expressed as "× its own median".
//   2. Top-trader positioning: OI-weighted top-trader ACCOUNT ratio and
//      POSITION (size) ratio. Their quotient shows which side carries larger
//      position size per account (size concentration).
//   3. Footprint (aggressor-side taker buy/sell value) attributed to OI change:
//      OI rising with net taker buying = leveraged long build, etc.
//   4. Top-trader vs all-account (retail) long-share divergence.
// These are combined into a 0–100 Leverage Score and a long/short side bias.

export const LEVERAGE_DEFAULTS = {
  lookback: 200,      // bars for median / percentile baselines
  volLen: 20,         // bars of spot turnover averaged (Pine volLen)
  buildWindow: 24,    // bars summed for net leveraged build
  minFlowPct: 5,      // |taker imbalance| needed to attribute an OI change
  minSources: 1,
  minVenueHistory: 30, // bars a venue needs before its own median is trusted
};
export const SCORE_WEIGHTS = { pressure: 0.35, build: 0.25, crowding: 0.2, sizeSkew: 0.2 };

const finite = value => typeof value === "number" && Number.isFinite(value);
const share = ratio => finite(ratio) && ratio > 0 ? ratio / (1 + ratio) : null;

export function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
/** Percentile rank (0–100) of `value` within `values` (inclusive midrank). */
export function percentileRank(values, value) {
  const list = values.filter(finite);
  if (!finite(value) || list.length < 10) return null;
  let below = 0, equal = 0;
  for (const item of list) { if (item < value) below++; else if (item === value) equal++; }
  return 100 * (below + 0.5 * equal) / list.length;
}

/** OI-weighted share aggregation (same method as LSAR: weight shares, not ratios). */
export function weightedShare(items) {
  let weight = 0, long = 0;
  for (const { ratio, weight: w } of items) {
    const s = share(ratio);
    if (s === null || !finite(w) || w <= 0) continue;
    weight += w; long += w * s;
  }
  return weight > 0 ? long / weight : null;
}

/**
 * Merge per-venue bars into aggregate bars.
 * venues: { [exchange]: Array<{ time, oiUsd?, price?, spotTurnoverUsd?, topAccountRatio?,
 *   topPositionRatio?, globalAccountRatio?, takerBuyUsd?, takerSellUsd?, longLiqUsd?, shortLiqUsd? }> }
 */
export function mergeVenueBars(venues) {
  const times = new Set();
  const index = {};
  for (const [exchange, bars] of Object.entries(venues)) {
    index[exchange] = new Map(bars.map(bar => [bar.time, bar]));
    for (const bar of bars) times.add(bar.time);
  }
  return [...times].sort((a, b) => a - b).map(time => {
    const rows = Object.entries(index).map(([exchange, map]) => [exchange, map.get(time)]).filter(([, bar]) => bar);
    const oiRows = rows.filter(([, bar]) => finite(bar.oiUsd) && bar.oiUsd > 0);
    // Pine semantics: pressure uses only venues with BOTH OI and spot turnover.
    const matched = rows.filter(([, bar]) => finite(bar.oiUsd) && bar.oiUsd > 0 && finite(bar.spotTurnoverUsd) && bar.spotTurnoverUsd > 0);
    const flowRows = rows.filter(([, bar]) => finite(bar.takerBuyUsd) && finite(bar.takerSellUsd));
    const liqRows = rows.filter(([, bar]) => finite(bar.longLiqUsd) && finite(bar.shortLiqUsd));
    const weightOf = exchange => index[exchange].get(time)?.oiUsd;
    const sideItems = field => rows.filter(([, bar]) => finite(bar[field]))
      .map(([exchange, bar]) => ({ ratio: bar[field], weight: weightOf(exchange) }));
    const prices = oiRows.map(([, bar]) => bar.price).filter(value => finite(value) && value > 0);
    const sum = (list, field) => list.reduce((total, [, bar]) => total + bar[field], 0);
    return {
      time,
      oiUsd: oiRows.length ? sum(oiRows, "oiUsd") : null,
      oiSources: oiRows.map(([exchange]) => exchange),
      oiByVenue: Object.fromEntries(oiRows.map(([exchange, bar]) => [exchange, bar.oiUsd])),
      spotByVenue: Object.fromEntries(rows.filter(([, bar]) => finite(bar.spotTurnoverUsd) && bar.spotTurnoverUsd > 0)
        .map(([exchange, bar]) => [exchange, bar.spotTurnoverUsd])),
      matchedOiUsd: matched.length ? sum(matched, "oiUsd") : null,
      matchedSpotUsd: matched.length ? sum(matched, "spotTurnoverUsd") : null,
      matchedSources: matched.map(([exchange]) => exchange),
      price: median(prices),
      takerBuyUsd: flowRows.length ? sum(flowRows, "takerBuyUsd") : null,
      takerSellUsd: flowRows.length ? sum(flowRows, "takerSellUsd") : null,
      flowSources: flowRows.map(([exchange]) => exchange),
      longLiqUsd: liqRows.length ? sum(liqRows, "longLiqUsd") : null,
      shortLiqUsd: liqRows.length ? sum(liqRows, "shortLiqUsd") : null,
      topAccountLongShare: weightedShare(sideItems("topAccountRatio")),
      topPositionLongShare: weightedShare(sideItems("topPositionRatio")),
      globalAccountLongShare: weightedShare(sideItems("globalAccountRatio")),
      topSources: rows.filter(([, bar]) => finite(bar.topPositionRatio) || finite(bar.topAccountRatio)).map(([exchange]) => exchange),
    };
  });
}

/** Classify an OI change by aggressor flow (OI × CVD quadrant). */
export function classifyBuild(oiChangeUsd, imbalancePct, minFlowPct = LEVERAGE_DEFAULTS.minFlowPct) {
  if (!finite(oiChangeUsd) || !finite(imbalancePct) || oiChangeUsd === 0 || Math.abs(imbalancePct) < minFlowPct)
    return { state: "neutral", longUsd: 0, shortUsd: 0 };
  const size = Math.abs(oiChangeUsd);
  if (oiChangeUsd > 0) return imbalancePct > 0
    ? { state: "long-build", longUsd: size, shortUsd: 0 }
    : { state: "short-build", longUsd: 0, shortUsd: size };
  return imbalancePct < 0
    ? { state: "long-unwind", longUsd: -size, shortUsd: 0 }
    : { state: "short-unwind", longUsd: 0, shortUsd: -size };
}

export function calculateLeverage(merged, options = {}) {
  const o = { ...LEVERAGE_DEFAULTS, ...options };
  const rows = [];
  const pressureRatios = [], buildRatios = [], crowding = [], skews = [];
  const venueRatios = {};
  for (let i = 0; i < merged.length; i++) {
    const bar = merged[i], prior = merged[i - 1];
    // --- 1. OI / average spot-turnover pressure ---
    // Each venue is compared with ITS OWN median (OI_v / avg spot_v), then the
    // venue ratios are OI-weighted. Venues joining/leaving (e.g. OKX/Gate keep
    // 100 bars, Binance 500) therefore cannot fake a pressure jump.
    let weighted = 0, weightSum = 0, aggregateTurnover = 0, aggregateSpot = 0;
    const matchedSources = [];
    for (const [exchange, oi] of Object.entries(bar.oiByVenue ?? {})) {
      const spots = merged.slice(Math.max(0, i - o.volLen + 1), i + 1)
        .map(item => item.spotByVenue?.[exchange]).filter(value => finite(value) && value > 0);
      if (!spots.length || !finite(bar.spotByVenue?.[exchange])) continue;
      const ratio = oi / (spots.reduce((x, y) => x + y, 0) / spots.length);
      const history = (venueRatios[exchange] ??= []);
      history.push(ratio);
      if (history.length > o.lookback) history.shift();
      const base = median(history);
      aggregateTurnover += oi; aggregateSpot += oi / ratio;
      if (history.length >= Math.min(o.lookback, o.minVenueHistory) && base > 0) {
        weighted += oi * (ratio / base); weightSum += oi; matchedSources.push(exchange);
      }
    }
    const oiTurnover = aggregateSpot > 0 ? aggregateTurnover / aggregateSpot : null;
    const vsMedian = weightSum > 0 && matchedSources.length >= o.minSources ? weighted / weightSum : null;

    // --- 2. OI change on the SAME venue cohort in both bars ---
    let oiChangeUsd = null;
    if (prior?.oiByVenue && bar.oiByVenue) {
      const common = Object.keys(bar.oiByVenue).filter(exchange => finite(prior.oiByVenue[exchange]));
      if (common.length) oiChangeUsd = common.reduce((total, exchange) => total + bar.oiByVenue[exchange] - prior.oiByVenue[exchange], 0);
    }
    // --- 3. Footprint: aggressor imbalance ---
    const totalFlow = finite(bar.takerBuyUsd) && finite(bar.takerSellUsd) ? bar.takerBuyUsd + bar.takerSellUsd : null;
    const imbalancePct = totalFlow > 0 ? 100 * (bar.takerBuyUsd - bar.takerSellUsd) / totalFlow : null;
    const build = classifyBuild(oiChangeUsd, imbalancePct, o.minFlowPct);

    const recent = rows.slice(-(o.buildWindow - 1)).concat([{ longBuildUsd: build.longUsd, shortBuildUsd: build.shortUsd }]);
    const netLongBuildUsd = recent.reduce((total, row) => total + row.longBuildUsd, 0);
    const netShortBuildUsd = recent.reduce((total, row) => total + row.shortBuildUsd, 0);
    const buildOfOi = finite(bar.oiUsd) && bar.oiUsd > 0 ? 100 * (netLongBuildUsd + netShortBuildUsd) / bar.oiUsd : null;

    // --- 4. Top-trader positioning ---
    const p = bar.topPositionLongShare, a = bar.topAccountLongShare, g = bar.globalAccountLongShare;
    // Size skew K = (long size per long account) / (short size per short account)
    //             = positionRatio / accountRatio. ln K > 0: longs carry bigger size.
    const sizeSkew = finite(p) && finite(a) && p > 0 && p < 1 && a > 0 && a < 1
      ? Math.log((p / (1 - p)) / (a / (1 - a))) : null;
    const topCrowding = finite(p) ? Math.abs(p - 0.5) : null;
    const retailDivergencePct = finite(g) && finite(p) ? 100 * (g - p) : null;

    // --- 5. Composite score from percentile ranks over the lookback ---
    const ranks = {
      pressure: percentileRank(pressureRatios.slice(-o.lookback), vsMedian),
      build: percentileRank(buildRatios.slice(-o.lookback), finite(buildOfOi) ? Math.abs(buildOfOi) : null),
      crowding: percentileRank(crowding.slice(-o.lookback), topCrowding),
      sizeSkew: percentileRank(skews.slice(-o.lookback), finite(sizeSkew) ? Math.abs(sizeSkew) : null),
    };
    if (finite(vsMedian)) pressureRatios.push(vsMedian);
    if (finite(buildOfOi)) buildRatios.push(Math.abs(buildOfOi));
    if (finite(topCrowding)) crowding.push(topCrowding);
    if (finite(sizeSkew)) skews.push(Math.abs(sizeSkew));
    let weight = 0, score = 0;
    for (const [key, rank] of Object.entries(ranks)) if (finite(rank)) { weight += SCORE_WEIGHTS[key]; score += SCORE_WEIGHTS[key] * rank; }
    // Require the OI/turnover pressure component plus at least one other input.
    const components = Object.values(ranks).filter(finite).length;
    const leverageScore = finite(ranks.pressure) && components >= 2 ? score / weight : null;

    // Side bias in [-1, 1]: + long-side leverage heavier, − short-side heavier.
    const biasParts = [];
    const builtTotal = Math.abs(netLongBuildUsd) + Math.abs(netShortBuildUsd);
    if (builtTotal > 0) biasParts.push((netLongBuildUsd - netShortBuildUsd) / builtTotal);
    if (finite(sizeSkew)) biasParts.push(Math.tanh(sizeSkew * 3));
    if (finite(p)) biasParts.push(Math.max(-1, Math.min(1, (p - 0.5) * 4)));
    const sideBias = biasParts.length ? biasParts.reduce((x, y) => x + y, 0) / biasParts.length : null;

    rows.push({
      time: bar.time, price: bar.price, oiUsd: bar.oiUsd, oiSources: bar.oiSources,
      matchedSources, oiTurnover, vsMedian,
      pressureIndex: finite(vsMedian) ? 100 * vsMedian : null,
      oiChangeUsd, imbalancePct, buildState: build.state,
      longBuildUsd: build.longUsd, shortBuildUsd: build.shortUsd, netLongBuildUsd, netShortBuildUsd, buildOfOiPct: buildOfOi,
      topAccountLongShare: a, topPositionLongShare: p, globalAccountLongShare: g,
      sizeSkew, retailDivergencePct, longLiqUsd: bar.longLiqUsd, shortLiqUsd: bar.shortLiqUsd,
      ranks, leverageScore, sideBias,
      flowSources: bar.flowSources, topSources: bar.topSources,
    });
  }
  return rows;
}

export function leverageRegime(score) {
  if (!finite(score)) return "unavailable";
  return score >= 80 ? "extreme" : score >= 60 ? "elevated" : score >= 40 ? "normal" : "low";
}
export function sideLabel(bias) {
  if (!finite(bias)) return "unavailable";
  return bias >= 0.2 ? "long-heavy" : bias <= -0.2 ? "short-heavy" : "balanced";
}
