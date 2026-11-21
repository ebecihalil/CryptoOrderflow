// OI Market Driver: port of the owner's Pine script "Multi-Exchange Aggregated
// Crypto Open Interest" (Market Driver states, flat OI/CVD/price matrices, pinbars,
// top-trader L/S notes, grey low-volume candles, whale OI spikes with pullbacks and
// bullish/bearish signal states). Data comes from the site's own aggregation:
// OI of every exchange, perpetual CVD of every recorded exchange, recorded
// liquidations and the Top Trader long/short account ratio.

export const MARKET_DRIVER_DEFAULTS = {
  stateColors: true, showTotals: true, useLsr: true,
  flatBodyPct: 15, flatActivityLength: 20, flatActivityFactor: 3,
  pinbarBodyPct: 10, pinbarWickPct: 50, pinbarWickRatio: 2,
  spikeMult: 5, avgLength: 50, maxSidewaysBars: 10, pullback1: 10, pullback2: 20,
};
export const MARKET_DRIVER_COLORS = {
  up: "#3b82f6", down: "#ef4444",
  longBuild: "#3b82f6", shortBuild: "#f23645", limBuyAbsorb: "#22c55e", limSellAbsorb: "#f97316",
  shortExitLiq: "#facc15", longExitLiq: "#861aec", neutral: "#737373", lowVolume: "#808080",
};
const MIN_LIQ_OI_RATIO = 0.001;

const isNum = value => typeof value === "number" && Number.isFinite(value);
/** ta.sma with Pine semantics: null until `length` values exist, null if any value in the window is null. */
function sma(values, index, length) {
  if (index < length - 1) return null;
  let sum = 0;
  for (let k = index - length + 1; k <= index; k++) { if (!isNum(values[k])) return null; sum += values[k]; }
  return sum / length;
}
function pinbarFlags(open, high, low, close, bodyThreshold, wickThreshold, wickRatio) {
  if (![open, high, low, close].every(isNum)) return { any: false, bullish: false, bearish: false };
  const range = high - low, body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close), lowerWick = Math.min(open, close) - low;
  const bodyPct = range > 0 ? body / range * 100 : 100;
  const smallBody = range > 0 && bodyPct <= bodyThreshold;
  const bullish = smallBody && lowerWick / range * 100 >= wickThreshold && lowerWick >= upperWick * wickRatio;
  const bearish = smallBody && upperWick / range * 100 >= wickThreshold && upperWick >= lowerWick * wickRatio;
  return { any: bullish || bearish, bullish, bearish };
}
const lsrComment = (rising, falling, risingText, fallingText) => rising ? risingText : falling ? fallingText : "";

/**
 * @param bars [{time, price:{open,high,low,close}, oi:{high,low,close} (coins), cvd:{open,high,low,close,buy,sell}|null,
 *               liqLongUsd, liqShortUsd, lsr (top-trader long/short ratio)|null}]
 * @returns per bar: {time, open, high, low, close, color, bodyColor, state, driverTop, driverBottom, bullId, bearId,
 *          pullback1, pullback2, buyPct, sellPct} and spike labels [{time, value, text, color}]
 */
export function calculateMarketDriver(bars, settings = {}, colors = MARKET_DRIVER_COLORS) {
  const s = { ...MARKET_DRIVER_DEFAULTS, ...settings };
  const n = bars.length;
  const oiC = bars.map(bar => isNum(bar.oi?.close) ? bar.oi.close : null);
  const oiDelta = oiC.map((c, i) => c === null ? null : c - (i > 0 && oiC[i - 1] !== null ? oiC[i - 1] : c));
  const oiActivity = oiDelta.map(d => d === null ? null : Math.abs(d));
  const delta = bars.map(bar => bar.cvd && isNum(bar.cvd.close) && isNum(bar.cvd.open) ? bar.cvd.close - bar.cvd.open : null);
  const cvdActivity = delta.map(d => d === null ? null : Math.abs(d));
  const priceBody = bars.map(bar => Math.abs(bar.price.close - bar.price.open));
  const aggVol = bars.map(bar => bar.cvd ? (bar.cvd.buy ?? 0) + (bar.cvd.sell ?? 0) : 0);
  const liqLong = bars.map(bar => bar.price.close > 0 && isNum(bar.liqLongUsd) ? bar.liqLongUsd / bar.price.close : 0);
  const liqShort = bars.map(bar => bar.price.close > 0 && isNum(bar.liqShortUsd) ? bar.liqShortUsd / bar.price.close : 0);
  const out = [], labels = [];
  // Whale spike sequence state.
  let greenStreak = 0, inSeq = false, initialOpen = null, seqHigh = null, seqHighIndex = null, sinceHigh = 0, label = null;
  const bodies = [];

  for (let i = 0; i < n; i++) {
    const bar = bars[i], p = bar.price, totalC = oiC[i];
    if (totalC === null) { out.push(null); bodies.push(null); continue; }
    const prevC = i > 0 && oiC[i - 1] !== null ? oiC[i - 1] : totalC;
    const oiOpen = prevC, oiClose = totalC;
    const oiHigh = Math.max(oiOpen, oiClose, isNum(bar.oi.high) ? bar.oi.high : oiClose);
    const oiLow = Math.min(oiOpen, oiClose, isNum(bar.oi.low) ? bar.oi.low : oiClose);
    const d = oiDelta[i];

    // ---- flatness and pinbars ----
    const oiRange = oiHigh - oiLow, oiBodyPct = oiRange > 0 ? Math.abs(oiClose - oiOpen) / oiRange * 100 : 0;
    const oiAvg = sma(oiActivity, i, s.flatActivityLength);
    const oiLowActivity = oiAvg !== null && oiAvg > 0 && oiActivity[i] <= oiAvg / s.flatActivityFactor;
    const oiFlat = oiRange === 0 || oiBodyPct <= s.flatBodyPct || oiLowActivity;

    const cvd = bar.cvd, hasCvd = !!cvd && delta[i] !== null, volDelta = hasCvd ? delta[i] : null;
    const cvdRange = hasCvd ? cvd.high - cvd.low : null;
    const cvdBodyPct = cvdRange !== null && cvdRange > 0 ? Math.abs(cvd.close - cvd.open) / cvdRange * 100 : 0;
    const cvdAvg = sma(cvdActivity, i, s.flatActivityLength);
    const cvdLowActivity = cvdActivity[i] !== null && cvdAvg !== null && cvdAvg > 0 && cvdActivity[i] <= cvdAvg / s.flatActivityFactor;
    const cvdFlat = hasCvd && (cvdRange === 0 || cvdBodyPct <= s.flatBodyPct || cvdLowActivity);

    const priceRange = p.high - p.low, priceBodyPct = priceRange > 0 ? priceBody[i] / priceRange * 100 : 0;
    const priceAvg = sma(priceBody, i, s.flatActivityLength);
    const priceLowActivity = priceAvg !== null && priceAvg > 0 && priceBody[i] <= priceAvg / s.flatActivityFactor;
    const priceFlat = priceRange === 0 || priceBodyPct <= s.flatBodyPct || priceLowActivity;
    // (pinbar flags are computed as in the script; they do not change the state on their own)
    pinbarFlags(oiOpen, oiHigh, oiLow, oiClose, s.pinbarBodyPct, s.pinbarWickPct, s.pinbarWickRatio);

    const priceUp = !priceFlat && p.close > p.open, priceDn = !priceFlat && p.close < p.open;
    const cvdUp = volDelta !== null && volDelta > 0, cvdDn = volDelta !== null && volDelta < 0;
    const flatCvdUp = cvdUp && !cvdFlat, flatCvdDn = cvdDn && !cvdFlat;
    const flatOiUp = !oiFlat && d > 0, flatOiDn = !oiFlat && d < 0;

    // ---- top-trader long/short ratio direction (latest candle vs previous) ----
    const lsr = isNum(bar.lsr) ? bar.lsr : null, lsrPrev = i > 0 && isNum(bars[i - 1].lsr) ? bars[i - 1].lsr : null;
    const lsrHasData = lsr !== null;
    const lsrRising = s.useLsr && lsrHasData && lsrPrev !== null && lsr > lsrPrev;
    const lsrFalling = s.useLsr && lsrHasData && lsrPrev !== null && lsr < lsrPrev;

    // ---- liquidations (≥ 0.1% of OI and above 20% of their 20-bar average) ----
    const liqLongAvg = sma(liqLong, i, 20), liqShortAvg = sma(liqShort, i, 20);
    const hasLongLiq = totalC > 0 && liqLong[i] >= totalC * MIN_LIQ_OI_RATIO && liqLongAvg !== null && liqLong[i] > liqLongAvg * 0.2;
    const hasShortLiq = totalC > 0 && liqShort[i] >= totalC * MIN_LIQ_OI_RATIO && liqShortAvg !== null && liqShort[i] > liqShortAvg * 0.2;

    // ---- price-flat matrix ----
    const isPriceFlatVariation = priceFlat && !oiFlat && !cvdFlat && d !== 0 && (cvdUp || cvdDn);
    const priceFlatName = !oiFlat && !cvdFlat && d > 0 && cvdUp ? "Limit Sell Absorption"
      : !oiFlat && !cvdFlat && d > 0 && cvdDn ? "Limit Buy Absorption"
      : !oiFlat && !cvdFlat && d < 0 && cvdUp ? "Short Exit while absorbed"
      : !oiFlat && !cvdFlat && d < 0 && cvdDn ? "Long Exit while absorbed" : "Price Flat / Mixed Rotation";

    // ---- groups ----
    const isLongBuild = d > 0 && cvdUp && priceUp, isShortBuild = d > 0 && cvdDn && priceDn;
    const isLimBuyAbsorb = d > 0 && cvdDn && priceUp, isLimSellAbsorb = d > 0 && cvdUp && priceDn;
    const isShortLiq = d < 0 && cvdUp && priceUp && hasShortLiq, isShortCover = d < 0 && cvdUp && priceUp && !hasShortLiq;
    const isLongLiq = d < 0 && cvdDn && priceDn && hasLongLiq, isLongCover = d < 0 && cvdDn && priceDn && !hasLongLiq;
    const isPasvShortCover = d < 0 && cvdDn && priceUp && !hasLongLiq, isLongLiqAbsorb = d < 0 && cvdDn && priceUp && hasLongLiq;
    const isPasvLongCover = d < 0 && cvdUp && priceDn && !hasShortLiq, isShortLiqAbsorb = d < 0 && cvdUp && priceDn && hasShortLiq;

    // ---- flat OI / flat CVD matrices ----
    const flatOiName = flatCvdUp && priceUp ? "Aggressive Long Rotation" : flatCvdDn && priceDn ? "Aggressive Short Rotation"
      : flatCvdDn && priceUp ? "Long Limit Absorption" : flatCvdUp && priceDn ? "Sell Limit Absorption"
      : flatCvdUp && priceFlat ? "Sell Limit Absorption" : flatCvdDn && priceFlat ? "Long Limit Absorption" : "Mixed Position Rotation";
    const flatBothName = priceUp ? "Thin Sell Limit Wall" : priceDn ? "Thin Buy Limit Wall" : "Balanced Position Rotation";
    const flatCvdName = flatOiUp && priceUp ? "Thick Buy Limit Wall" : flatOiUp && priceDn ? "Thick Sell Limit Wall"
      : flatOiUp && priceFlat ? "OI Expansion" : flatOiDn && priceUp ? "Thin Sell Limit Wall"
      : flatOiDn && priceDn ? "Thin Buy Limit Wall" : flatOiDn && priceFlat ? "OI Reduction" : "CVD Flat / Mixed Position Rotation";
    const isFlatOi = oiFlat && hasCvd, isFlatBoth = isFlatOi && cvdFlat, isFlatCvd = cvdFlat && !oiFlat;
    const whaleDump = isFlatOi && flatCvdDn && priceDn && lsrRising;
    const whaleAccumulation = isFlatOi && flatCvdUp && priceUp && lsrFalling;

    // ---- colour (same priority as the script) ----
    const c = colors;
    const stateColor = whaleDump ? c.longExitLiq : isLongBuild ? c.longBuild : isShortBuild ? c.shortBuild
      : isLimBuyAbsorb ? c.limBuyAbsorb : isLimSellAbsorb ? c.limSellAbsorb
      : isPriceFlatVariation && d > 0 && cvdUp ? c.limSellAbsorb : isPriceFlatVariation && d > 0 && cvdDn ? c.limBuyAbsorb
      : isPriceFlatVariation && d < 0 && cvdUp ? c.shortExitLiq : isPriceFlatVariation && d < 0 && cvdDn ? c.longExitLiq
      : isShortLiq || isShortCover ? c.shortExitLiq : isLongLiq || isLongCover ? c.longExitLiq
      : isPasvShortCover || isLongLiqAbsorb ? c.longExitLiq : isPasvLongCover || isShortLiqAbsorb ? c.shortExitLiq : c.neutral;

    // ---- L/S note (second line) ----
    const L = (a, b) => lsrComment(lsrRising, lsrFalling, a, b);
    const note = !s.useLsr || !lsrHasData || (!lsrRising && !lsrFalling) ? ""
      : isFlatBoth ? (priceUp ? L("Retail Long Accumulation", "Whale Long Accumulation") : priceDn ? L("Whale Short Accumulation", "Retail Short Accumulation") : L("Retail replaces Whales", "Whale Replaces Retail"))
      : isFlatOi ? (flatCvdUp && priceUp ? L("Long Whales Dump (Distribution)", "Whale Longs Replace Retail (Accumulation)")
        : flatCvdDn && priceDn ? L("Short Whales Dump (Distribution)", "Whale Shorts Replace Retail (Accumulation)")
        : flatCvdDn && priceUp ? L("Short Retail is Out", "Long Whale Accumulation")
        : flatCvdUp && priceDn ? L("Short Whale Accumulation", "Long Retail is Out")
        : flatCvdUp && priceFlat ? L("Short Whale Accumulation", "Long Retail is Out")
        : flatCvdDn && priceFlat ? L("Short Retail is Out", "Long Whale Accumulation") : L("Retail position rotation", "Whale position rotation"))
      : isFlatCvd ? (flatOiUp && priceUp ? L("Retail Long Accumulation", "Whale Long Accumulation")
        : flatOiUp && priceDn ? L("Whale Short Accumulation", "Retail Short Accumulation")
        : flatOiUp && priceFlat ? L("Retail Long vs Whale Short CVD", "Whale Long vs Retail Short")
        : flatOiDn && priceUp ? L("Whale Longs Exit", "Retail Longs Exit")
        : flatOiDn && priceDn ? L("Retail Shorts Exit", "Whale Shorts Exit")
        : flatOiDn && priceFlat ? L("Short Retail vs Long Whale", "Long Retail vs Short Whale") : L("Retail CVD Bias", "Whale CVD Bias"))
      : isPriceFlatVariation ? (d > 0 && cvdUp ? L("Retail Longs Trapped", "Fragile Sell Limit Wall")
        : d > 0 && cvdDn ? L("Fragile Long Limit Wall", "Short Retails Trapped")
        : d < 0 && cvdUp ? L("Complex dynamics", "Retail Short Exit") : L("Complex dynamics", "Retail Long Exit"))
      : isLongBuild ? L("Retail accumulation", "Whale accumulation") : isShortBuild ? L("Whale Accumulation", "Retail Accumulation")
      : isLimBuyAbsorb ? L("Fragile Long Limit Wall", "Short Retails Trapped") : isLimSellAbsorb ? L("Long Retails Trapped", "Fragile Sell Limit Wall")
      : isShortLiq ? L("Retail Shorts Wiped off", "Retail Longs exit with profit") : isShortCover ? L("Retail Shorts exit with Loss", "Retail Longs exit with profit")
      : isLongLiq ? L("Retail Longs build the dip", "Long Retails flushed out") : isLongCover ? L("Retail Longs trapped", "Retail Longs Exit")
      : isPasvShortCover ? L("Complex dynamics", "Retail Long Exit") : isLongLiqAbsorb ? L("Complex dynamics", "Retail Long Liquidation")
      : isPasvLongCover ? L("Complex dynamics", "Retail Short Exit") : isShortLiqAbsorb ? L("Complex dynamics", "Retail Short Liquidation")
      : L("Retail bias", "Whale bias");

    const state = isFlatBoth ? `Flat OI + CVD Flat: ${flatBothName}` : isFlatOi ? `Flat OI: ${flatOiName}` : isFlatCvd ? `CVD Flat: ${flatCvdName}`
      : isPriceFlatVariation ? priceFlatName : isLongBuild ? "Aggressive Longs Openings" : isShortBuild ? "Aggressive Shorts Openings"
      : isLimBuyAbsorb ? "Limit Buy Absorption (Open)" : isLimSellAbsorb ? "Limit Sell Absorption (Open)" : isShortLiq ? "Short Liquidation"
      : isShortCover ? "Short Exit" : isLongLiq ? "Long Liquidation" : isLongCover ? "Long Exit" : isPasvShortCover ? "Long Exit while absorbed"
      : isLongLiqAbsorb ? "Long Liquidation while absorbed" : isPasvLongCover ? "Short Exit while absorbed" : isShortLiqAbsorb ? "Short Liquidation while absorbed" : "Neutral / Choppy";

    // ---- candle colour: state (or up/down), grey body when aggressive volume is below its 20-bar average ----
    const col = s.stateColors || whaleDump ? stateColor : oiClose >= oiOpen ? c.up : c.down;
    const volAvg = sma(aggVol, i, 20);
    const volumePass = aggVol[i] > 0 && volAvg !== null && aggVol[i] >= volAvg;

    // ---- bullish / bearish signal states ----
    const bearId = isShortBuild && lsrRising ? 3 : isLimSellAbsorb && lsrRising ? 7 : isLongLiq && lsrRising ? 13 : isLongCover && lsrRising ? 15
      : whaleDump ? 28 : isFlatOi && flatCvdUp && priceDn && lsrRising ? 31 : isFlatOi && flatCvdUp && priceFlat && lsrRising ? 33
      : isFlatBoth && priceDn && lsrRising ? 39 : 0;
    const bullId = isLongBuild && lsrFalling ? 1 : isLimBuyAbsorb && lsrFalling ? 6 : isShortLiq && lsrFalling ? 10 : isShortCover && lsrFalling ? 12
      : whaleAccumulation ? 25 : isFlatOi && flatCvdDn && priceUp && lsrFalling ? 30 : isFlatOi && flatCvdDn && priceFlat && lsrFalling ? 36
      : isFlatBoth && priceUp && lsrFalling ? 38 : isFlatCvd && flatOiUp && priceUp && lsrFalling ? 44 : 0;

    // ---- whale OI spike & continuation ----
    const body = oiClose - oiOpen;
    bodies.push(Math.abs(body));
    const avgBody = sma(bodies, i, s.avgLength), prevAvgBody = i > 0 ? sma(bodies, i - 1, s.avgLength) : null;
    greenStreak = oiClose > oiOpen ? greenStreak + 1 : 0;
    const singleSpike = !inSeq && body > 0 && body >= s.spikeMult * (prevAvgBody ?? avgBody ?? Infinity);
    const tenGreen = !inSeq && greenStreak === 10;
    let pullback1 = false, pullback2 = false;
    if (singleSpike || tenGreen) {
      inSeq = true;
      initialOpen = tenGreen ? (out[i - 9]?.open ?? oiOpen) : oiOpen;
      seqHigh = oiHigh; seqHighIndex = i; sinceHigh = 0;
      label = { start: i };
      labels.push(label);
    } else if (inSeq) {
      if (oiHigh > seqHigh) { seqHigh = oiHigh; seqHighIndex = i; sinceHigh = 0; } else sinceHigh++;
    }
    if (inSeq && label) {
      const pct = initialOpen > 0 ? (seqHigh - initialOpen) / initialOpen * 100 : 0;
      Object.assign(label, { time: bars[seqHighIndex].time, value: seqHigh, text: `${pct.toFixed(2)}%`, color: pct > 30 ? "#b91c1c" : "#15803d" });
      const range = seqHigh - initialOpen, ratio = range > 0 ? (seqHigh - oiClose) / range * 100 : 0;
      pullback1 = ratio >= s.pullback1; pullback2 = ratio >= s.pullback2;
      if (sinceHigh >= s.maxSidewaysBars || oiClose < initialOpen) { inSeq = false; seqHigh = null; seqHighIndex = null; sinceHigh = 0; }
    }

    const total = cvd ? (cvd.buy ?? 0) + (cvd.sell ?? 0) : 0;
    out.push({
      time: bar.time, open: oiOpen, high: oiHigh, low: oiLow, close: oiClose,
      color: col, bodyColor: volumePass ? col : c.lowVolume, stateColor, state,
      driverTop: state, driverBottom: note, bullId, bearId, pullback1, pullback2,
      buyPct: total > 0 ? cvd.buy / total * 100 : null, sellPct: total > 0 ? cvd.sell / total * 100 : null,
    });
  }
  return { bars: out, labels: labels.filter(item => item.time !== undefined).map(({ start, ...item }) => item) };
}
