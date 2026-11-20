// Popular technical indicators for Super Charts, computed from the chart's own
// exchange candles (no remote data, no lookahead, warm-up bars omitted rather
// than zero-filled). Defaults follow TradingView's built-ins so values match
// what traders expect.
//
// Each definition: { id, label, group, placement: "overlay" | "pane",
//   params: [{ key, label, default, min, max, step }], paneHeight?,
//   compute(candles, params) -> { series: [{ key, label, color, type, width?,
//     dashed?, data: [{ time, value|null }] }], fills?: [{ upper, lower, up, down }],
//     levels?: [{ value, label }], range?: [min, max] } }
// `null` values are gaps. Candles: { time (sec), open, high, low, close, volume }.

const isNum = value => typeof value === "number" && Number.isFinite(value);

// ---------- array helpers (index-aligned with candles; null = not available) ----------
export function smaArr(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) { sum = 0; count = 0; continue; }
    sum += v; count++;
    if (count > period) { sum -= values[i - period]; count = period; }
    if (count === period) out[i] = sum / period;
  }
  return out;
}
/** EMA seeded with the SMA of the first `period` valid values. */
export function emaArr(values, period, alpha = 2 / (period + 1)) {
  const out = new Array(values.length).fill(null);
  let value = null, seed = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) continue;
    if (value === null) {
      seed += v; count++;
      if (count === period) { value = seed / period; out[i] = value; }
    } else {
      value += alpha * (v - value);
      out[i] = value;
    }
  }
  return out;
}
/** Wilder's smoothing (RMA), as used by RSI/ATR/ADX. */
export const rmaArr = (values, period) => emaArr(values, period, 1 / period);
export function wmaArr(values, period) {
  const out = new Array(values.length).fill(null);
  const denominator = period * (period + 1) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0, ok = true;
    for (let k = 0; k < period; k++) {
      const v = values[i - k];
      if (!isNum(v)) { ok = false; break; }
      sum += v * (period - k);
    }
    if (ok) out[i] = sum / denominator;
  }
  return out;
}
const windowExtreme = (values, period, pick) => values.map((_, i) => {
  if (i < period - 1) return null;
  let best = values[i];
  for (let k = 1; k < period; k++) best = pick(best, values[i - k]);
  return best;
});
export const highestArr = (values, period) => windowExtreme(values, period, Math.max);
export const lowestArr = (values, period) => windowExtreme(values, period, Math.min);
export function trueRangeArr(candles) {
  return candles.map((c, i) => i === 0 ? c.high - c.low
    : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)));
}
export function rsiArr(values, period) {
  const gains = values.map((v, i) => i === 0 ? null : Math.max(v - values[i - 1], 0));
  const losses = values.map((v, i) => i === 0 ? null : Math.max(values[i - 1] - v, 0));
  const g = rmaArr(gains, period), l = rmaArr(losses, period);
  return values.map((_, i) => g[i] === null || l[i] === null ? null
    : l[i] === 0 ? (g[i] === 0 ? 50 : 100) : 100 - 100 / (1 + g[i] / l[i]));
}
const pts = (candles, values) => candles.map((c, i) => ({ time: c.time, value: isNum(values[i]) ? values[i] : null }));
const closes = candles => candles.map(c => c.close);
const highs = candles => candles.map(c => c.high);
const lows = candles => candles.map(c => c.low);
const hl2 = candles => candles.map(c => (c.high + c.low) / 2);
const typical = candles => candles.map(c => (c.high + c.low + c.close) / 3);
const volumes = candles => candles.map(c => (isNum(c.volume) && c.volume >= 0 ? c.volume : null));
const stepSeconds = candles => {
  const diffs = candles.slice(1).map((c, i) => c.time - candles[i].time).filter(d => d > 0).sort((a, b) => a - b);
  return diffs.length ? diffs[Math.floor(diffs.length / 2)] : 3600;
};

// ---------- indicator calculations ----------
export function keltner(candles, { length, multiplier, atrLength }) {
  const mid = emaArr(closes(candles), length);
  const atr = rmaArr(trueRangeArr(candles), atrLength);
  return {
    mid, upper: mid.map((m, i) => m === null || atr[i] === null ? null : m + multiplier * atr[i]),
    lower: mid.map((m, i) => m === null || atr[i] === null ? null : m - multiplier * atr[i]),
  };
}
export function donchian(candles, { length }) {
  const upper = highestArr(highs(candles), length), lower = lowestArr(lows(candles), length);
  return { upper, lower, mid: upper.map((u, i) => u === null ? null : (u + lower[i]) / 2) };
}
/**
 * Ichimoku: Senkou spans are plotted `displacement` bars AHEAD (future times are
 * extrapolated with the chart's bar interval); Chikou is plotted behind.
 */
export function ichimoku(candles, { conversion, base, spanB, displacement }) {
  const mid = n => {
    const hi = highestArr(highs(candles), n), lo = lowestArr(lows(candles), n);
    return hi.map((h, i) => h === null ? null : (h + lo[i]) / 2);
  };
  const tenkan = mid(conversion), kijun = mid(base), senkouBRaw = mid(spanB);
  const senkouARaw = tenkan.map((t, i) => t === null || kijun[i] === null ? null : (t + kijun[i]) / 2);
  const shift = displacement - 1; // TradingView plots spans offset displacement-1 bars ahead
  const step = stepSeconds(candles);
  const futureTime = i => (i < candles.length ? candles[i].time : candles[candles.length - 1].time + (i - candles.length + 1) * step);
  const ahead = raw => raw.map((v, i) => ({ time: futureTime(i + shift), value: v }));
  const chikou = candles.map((c, i) => ({ time: c.time, value: i + shift < candles.length ? candles[i + shift].close : null }));
  return { tenkan, kijun, senkouA: ahead(senkouARaw), senkouB: ahead(senkouBRaw), chikou };
}
export function psar(candles, { start, increment, maximum }) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < 2) return { sar: out, up: [] };
  let up = candles[1].close >= candles[0].close;
  let sar = up ? candles[0].low : candles[0].high;
  let ep = up ? candles[0].high : candles[0].low;
  let af = start;
  const trend = new Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1], prev2 = candles[i - 2] ?? prev;
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, prev.low, prev2.low);
      if (c.low < sar) { up = false; sar = ep; ep = c.low; af = start; }
      else if (c.high > ep) { ep = c.high; af = Math.min(af + increment, maximum); }
    } else {
      sar = Math.max(sar, prev.high, prev2.high);
      if (c.high > sar) { up = true; sar = ep; ep = c.high; af = start; }
      else if (c.low < ep) { ep = c.low; af = Math.min(af + increment, maximum); }
    }
    out[i] = sar; trend[i] = up;
  }
  return { sar: out, up: trend };
}
export function supertrend(candles, { atrLength, factor }) {
  const atr = rmaArr(trueRangeArr(candles), atrLength);
  const src = hl2(candles);
  const line = new Array(candles.length).fill(null), dir = new Array(candles.length).fill(null);
  let upper = null, lower = null, direction = 1, prevLine = null;
  for (let i = 0; i < candles.length; i++) {
    if (atr[i] === null) continue;
    const basicUpper = src[i] + factor * atr[i], basicLower = src[i] - factor * atr[i];
    const prevClose = i > 0 ? candles[i - 1].close : candles[i].close;
    const finalUpper = upper === null || basicUpper < upper || prevClose > upper ? basicUpper : upper;
    const finalLower = lower === null || basicLower > lower || prevClose < lower ? basicLower : lower;
    if (prevLine === null) direction = 1;
    else if (prevLine === upper) direction = candles[i].close > finalUpper ? -1 : 1;
    else direction = candles[i].close < finalLower ? 1 : -1;
    // TradingView convention: direction -1 = uptrend (line below price), 1 = downtrend.
    const value = direction === -1 ? finalLower : finalUpper;
    upper = finalUpper; lower = finalLower; prevLine = value;
    line[i] = value; dir[i] = direction;
  }
  return { line, dir };
}
export function stochastic(candles, { kLength, kSmoothing, dSmoothing }) {
  const hh = highestArr(highs(candles), kLength), ll = lowestArr(lows(candles), kLength);
  const raw = candles.map((c, i) => hh[i] === null ? null : hh[i] === ll[i] ? 50 : 100 * (c.close - ll[i]) / (hh[i] - ll[i]));
  const k = smaArr(raw, kSmoothing);
  return { k, d: smaArr(k, dSmoothing) };
}
export function stochRsi(candles, { rsiLength, stochLength, kSmoothing, dSmoothing }) {
  const rsi = rsiArr(closes(candles), rsiLength);
  const raw = rsi.map((v, i) => {
    if (v === null || i < stochLength - 1) return null;
    const window = rsi.slice(i - stochLength + 1, i + 1);
    if (window.some(x => x === null)) return null;
    const hi = Math.max(...window), lo = Math.min(...window);
    return hi === lo ? 50 : 100 * (v - lo) / (hi - lo);
  });
  const k = smaArr(raw, kSmoothing);
  return { k, d: smaArr(k, dSmoothing) };
}
export function adx(candles, { length }) {
  const plusDM = candles.map((c, i) => {
    if (i === 0) return null;
    const upMove = c.high - candles[i - 1].high, downMove = candles[i - 1].low - c.low;
    return upMove > downMove && upMove > 0 ? upMove : 0;
  });
  const minusDM = candles.map((c, i) => {
    if (i === 0) return null;
    const upMove = c.high - candles[i - 1].high, downMove = candles[i - 1].low - c.low;
    return downMove > upMove && downMove > 0 ? downMove : 0;
  });
  const tr = trueRangeArr(candles).map((v, i) => i === 0 ? null : v);
  const atr = rmaArr(tr, length), p = rmaArr(plusDM, length), m = rmaArr(minusDM, length);
  const plusDI = p.map((v, i) => v === null || !atr[i] ? null : 100 * v / atr[i]);
  const minusDI = m.map((v, i) => v === null || !atr[i] ? null : 100 * v / atr[i]);
  const dx = plusDI.map((v, i) => v === null || minusDI[i] === null ? null
    : v + minusDI[i] === 0 ? 0 : 100 * Math.abs(v - minusDI[i]) / (v + minusDI[i]));
  return { adx: rmaArr(dx, length), plusDI, minusDI };
}
export function cci(candles, { length }) {
  const tp = typical(candles), mean = smaArr(tp, length);
  return tp.map((v, i) => {
    if (mean[i] === null) return null;
    let dev = 0;
    for (let k = 0; k < length; k++) dev += Math.abs(tp[i - k] - mean[i]);
    dev /= length;
    return dev === 0 ? 0 : (v - mean[i]) / (0.015 * dev);
  });
}
export function williamsR(candles, { length }) {
  const hh = highestArr(highs(candles), length), ll = lowestArr(lows(candles), length);
  // `|| 0` turns -0 (close at the high) into 0 so it never displays as "-0.00".
  return candles.map((c, i) => hh[i] === null ? null : hh[i] === ll[i] ? -50 : (-100 * (hh[i] - c.close) / (hh[i] - ll[i])) || 0);
}
export function mfi(candles, { length }) {
  const tp = typical(candles), vol = volumes(candles);
  return candles.map((_, i) => {
    if (i < length) return null;
    let pos = 0, neg = 0;
    for (let k = i - length + 1; k <= i; k++) {
      if (vol[k] === null) return null;
      const flow = tp[k] * vol[k];
      if (tp[k] > tp[k - 1]) pos += flow; else if (tp[k] < tp[k - 1]) neg += flow;
    }
    return neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg);
  });
}
export function obv(candles) {
  const vol = volumes(candles);
  let total = 0;
  return candles.map((c, i) => {
    if (vol[i] === null) return null;
    if (i > 0) total += c.close > candles[i - 1].close ? vol[i] : c.close < candles[i - 1].close ? -vol[i] : 0;
    return total;
  });
}
export function roc(candles, { length }) {
  return candles.map((c, i) => i < length || candles[i - length].close === 0 ? null : 100 * (c.close / candles[i - length].close - 1));
}
export function cmf(candles, { length }) {
  const vol = volumes(candles);
  const mfv = candles.map((c, i) => vol[i] === null ? null : c.high === c.low ? 0 : ((c.close - c.low) - (c.high - c.close)) / (c.high - c.low) * vol[i]);
  return candles.map((_, i) => {
    if (i < length - 1) return null;
    let flow = 0, total = 0;
    for (let k = i - length + 1; k <= i; k++) {
      if (mfv[k] === null) return null;
      flow += mfv[k]; total += vol[k];
    }
    return total === 0 ? 0 : flow / total;
  });
}
/** VWAP anchored to each UTC day (TradingView "Session"). */
export function vwap(candles) {
  let day = null, pv = 0, v = 0;
  return candles.map(c => {
    const d = Math.floor(c.time / 86400);
    if (d !== day) { day = d; pv = 0; v = 0; }
    if (!isNum(c.volume) || c.volume < 0) return null;
    pv += (c.high + c.low + c.close) / 3 * c.volume; v += c.volume;
    return v > 0 ? pv / v : null;
  });
}

// ---------- more helpers ----------
/** Population standard deviation over `period` (TradingView ta.stdev). */
export function stdevArr(values, period) {
  const mean = smaArr(values, period);
  return values.map((_, i) => {
    if (mean[i] === null) return null;
    let sum = 0;
    for (let k = 0; k < period; k++) sum += (values[i - k] - mean[i]) ** 2;
    return Math.sqrt(sum / period);
  });
}
export function sumArr(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0, ok = true;
    for (let k = 0; k < period; k++) { const v = values[i - k]; if (!isNum(v)) { ok = false; break; } sum += v; }
    if (ok) out[i] = sum;
  }
  return out;
}
/** Least-squares line over the last `period` values, evaluated at the newest bar (ta.linreg offset 0). */
export function linregArr(values, period) {
  const out = new Array(values.length).fill(null);
  const n = period, sx = (n - 1) * n / 2, sxx = (n - 1) * n * (2 * n - 1) / 6, den = n * sxx - sx * sx;
  for (let i = period - 1; i < values.length; i++) {
    let sy = 0, sxy = 0, ok = true;
    for (let x = 0; x < n; x++) { const v = values[i - n + 1 + x]; if (!isNum(v)) { ok = false; break; } sy += v; sxy += x * v; }
    if (!ok) continue;
    const slope = den === 0 ? 0 : (n * sxy - sx * sy) / den, intercept = (sy - slope * sx) / n;
    out[i] = intercept + slope * (n - 1);
  }
  return out;
}
const changeArr = (values, n = 1) => values.map((v, i) => i < n || !isNum(v) || !isNum(values[i - n]) ? null : v - values[i - n]);
const combine = (a, b, fn) => a.map((x, i) => x === null || b[i] === null || x === undefined || b[i] === undefined ? null : fn(x, b[i], i));
const futureTimeOf = candles => {
  const step = stepSeconds(candles);
  return i => (i < candles.length ? candles[i].time : candles[candles.length - 1].time + (i - candles.length + 1) * step);
};
/** Plot `raw` shifted `shift` bars ahead (future bars get extrapolated times). */
const aheadPts = (candles, raw, shift) => { const t = futureTimeOf(candles); return raw.map((v, i) => ({ time: t(i + shift), value: isNum(v) ? v : null })); };
const bollinger = (candles, length, mult) => {
  const x = closes(candles), basis = smaArr(x, length), dev = stdevArr(x, length);
  return { basis, upper: combine(basis, dev, (b, d) => b + mult * d), lower: combine(basis, dev, (b, d) => b - mult * d) };
};

// ---------- more moving averages ----------
export const demaArr = (x, n) => { const e1 = emaArr(x, n), e2 = emaArr(e1, n); return combine(e1, e2, (a, b) => 2 * a - b); };
export const temaArr = (x, n) => { const e1 = emaArr(x, n), e2 = emaArr(e1, n), e3 = emaArr(e2, n); return e1.map((a, i) => a === null || e2[i] === null || e3[i] === null ? null : 3 * a - 3 * e2[i] + e3[i]); };
export function vwmaArr(candles, n) {
  const vol = volumes(candles), pv = candles.map((c, i) => vol[i] === null ? null : c.close * vol[i]);
  const a = smaArr(pv, n), b = smaArr(vol, n);
  return combine(a, b, (x, y) => y === 0 ? null : x / y);
}
export function almaArr(x, n, offset, sigma) {
  const m = offset * (n - 1), s = n / sigma, weights = Array.from({ length: n }, (_, k) => Math.exp(-((k - m) ** 2) / (2 * s * s)));
  const norm = weights.reduce((a, b) => a + b, 0);
  return x.map((_, i) => {
    if (i < n - 1) return null;
    let sum = 0;
    for (let k = 0; k < n; k++) { const v = x[i - (n - 1 - k)]; if (!isNum(v)) return null; sum += v * weights[k]; }
    return sum / norm;
  });
}
export function kamaArr(x, n, fast, slow) {
  const fastSC = 2 / (fast + 1), slowSC = 2 / (slow + 1), out = new Array(x.length).fill(null);
  let kama = null;
  for (let i = n; i < x.length; i++) {
    let volatility = 0;
    for (let k = 0; k < n; k++) volatility += Math.abs(x[i - k] - x[i - k - 1]);
    const er = volatility === 0 ? 0 : Math.abs(x[i] - x[i - n]) / volatility;
    const sc = (er * (fastSC - slowSC) + slowSC) ** 2;
    kama = kama === null ? x[i] : kama + sc * (x[i] - kama);
    out[i] = kama;
  }
  return out;
}
export function zlemaArr(x, n) {
  const lag = Math.floor((n - 1) / 2);
  return emaArr(x.map((v, i) => i < lag ? null : v + (v - x[i - lag])), n);
}
export function mcginleyArr(x, n) {
  const seed = emaArr(x, n), out = new Array(x.length).fill(null);
  let md = null;
  for (let i = 0; i < x.length; i++) {
    if (md === null) { if (seed[i] !== null) md = seed[i]; out[i] = md; continue; }
    md = md + (x[i] - md) / (n * Math.pow(x[i] / md, 4));
    out[i] = Number.isFinite(md) ? md : null;
  }
  return out;
}
export function t3Arr(x, n, v) {
  const e1 = emaArr(x, n), e2 = emaArr(e1, n), e3 = emaArr(e2, n), e4 = emaArr(e3, n), e5 = emaArr(e4, n), e6 = emaArr(e5, n);
  const c1 = -(v ** 3), c2 = 3 * v * v + 3 * v ** 3, c3 = -6 * v * v - 3 * v - 3 * v ** 3, c4 = 1 + 3 * v + v ** 3 + 3 * v * v;
  return x.map((_, i) => [e3, e4, e5, e6].some(e => e[i] === null) ? null : c1 * e6[i] + c2 * e5[i] + c3 * e4[i] + c4 * e3[i]);
}

// ---------- levels, stops & structure ----------
/** Traditional pivot points from the previous day (intraday), week (daily) or month (weekly+), UTC. */
export function pivotPoints(candles) {
  const step = stepSeconds(candles);
  const period = t => step < 86400 ? Math.floor(t / 86400) : step < 7 * 86400 ? Math.floor((t / 86400 + 3) / 7)
    : (d => d.getUTCFullYear() * 12 + d.getUTCMonth())(new Date(t * 1000));
  const keys = ["p", "r1", "s1", "r2", "s2", "r3", "s3"], out = Object.fromEntries(keys.map(k => [k, new Array(candles.length).fill(null)]));
  let current = null, hi = -Infinity, lo = Infinity, close = null, levels = null;
  candles.forEach((c, i) => {
    const key = period(c.time);
    if (key !== current) {
      if (current !== null && close !== null) {
        const p = (hi + lo + close) / 3;
        levels = { p, r1: 2 * p - lo, s1: 2 * p - hi, r2: p + (hi - lo), s2: p - (hi - lo), r3: hi + 2 * (p - lo), s3: lo - 2 * (hi - p) };
      }
      current = key; hi = -Infinity; lo = Infinity;
    }
    hi = Math.max(hi, c.high); lo = Math.min(lo, c.low); close = c.close;
    if (levels) for (const k of keys) out[k][i] = levels[k];
  });
  return out;
}
export function chandelierExit(candles, { length, multiplier }) {
  const atr = rmaArr(trueRangeArr(candles), length), hh = highestArr(highs(candles), length), ll = lowestArr(lows(candles), length);
  const longOut = new Array(candles.length).fill(null), shortOut = new Array(candles.length).fill(null);
  let longStop = null, shortStop = null, dir = 1;
  candles.forEach((c, i) => {
    if (atr[i] === null || hh[i] === null) return;
    let ls = hh[i] - multiplier * atr[i], ss = ll[i] + multiplier * atr[i];
    const prevClose = i > 0 ? candles[i - 1].close : c.close;
    if (longStop !== null && prevClose > longStop) ls = Math.max(ls, longStop);
    if (shortStop !== null && prevClose < shortStop) ss = Math.min(ss, shortStop);
    if (shortStop !== null && c.close > shortStop) dir = 1; else if (longStop !== null && c.close < longStop) dir = -1;
    longStop = ls; shortStop = ss;
    if (dir === 1) longOut[i] = ls; else shortOut[i] = ss;
  });
  return { long: longOut, short: shortOut };
}
export function volatilityStop(candles, { length, multiplier }) {
  const atr = rmaArr(trueRangeArr(candles), length), x = closes(candles);
  const up = new Array(candles.length).fill(null), down = new Array(candles.length).fill(null);
  let max = null, min = null, stop = null, uptrend = true;
  x.forEach((src, i) => {
    if (atr[i] === null) return;
    const a = atr[i] * multiplier;
    if (stop === null) { max = src; min = src; stop = src - a; uptrend = true; }
    max = Math.max(max, src); min = Math.min(min, src);
    stop = uptrend ? Math.max(stop, max - a) : Math.min(stop, min + a);
    const next = src - stop >= 0;
    if (next !== uptrend) { max = src; min = src; stop = next ? max - a : min + a; }
    uptrend = next;
    (uptrend ? up : down)[i] = stop;
  });
  return { up, down };
}
export function fractals(candles, n) {
  const up = new Array(candles.length).fill(null), down = new Array(candles.length).fill(null);
  for (let i = n; i < candles.length - n; i++) {
    let isHigh = true, isLow = true;
    for (let k = 1; k <= n; k++) {
      if (!(candles[i].high > candles[i - k].high && candles[i].high > candles[i + k].high)) isHigh = false;
      if (!(candles[i].low < candles[i - k].low && candles[i].low < candles[i + k].low)) isLow = false;
    }
    if (isHigh) up[i] = candles[i].high;
    if (isLow) down[i] = candles[i].low;
  }
  return { up, down };
}
/** ZigZag: swing points that reverse at least `deviation` % with `depth` bars between them, joined by straight lines. */
export function zigzag(candles, { deviation, depth }) {
  const pivots = [], moved = (from, to) => Math.abs(to - from) / from * 100 >= deviation;
  let dir = 0, hiAt = 0, loAt = 0, ext = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], last = pivots.at(-1), farEnough = idx => !last || idx - last.index >= depth;
    if (dir === 0) {
      if (c.high > candles[hiAt].high) hiAt = i;
      if (c.low < candles[loAt].low) loAt = i;
      if (moved(candles[hiAt].high, c.low) && hiAt < i) { pivots.push({ index: hiAt, value: candles[hiAt].high }); dir = -1; ext = i; }
      else if (moved(candles[loAt].low, c.high) && loAt < i) { pivots.push({ index: loAt, value: candles[loAt].low }); dir = 1; ext = i; }
    } else if (dir === 1) {
      if (c.high > candles[ext].high) ext = i;
      else if (moved(candles[ext].high, c.low) && farEnough(ext)) { pivots.push({ index: ext, value: candles[ext].high }); dir = -1; ext = i; }
    } else {
      if (c.low < candles[ext].low) ext = i;
      else if (moved(candles[ext].low, c.high) && farEnough(ext)) { pivots.push({ index: ext, value: candles[ext].low }); dir = 1; ext = i; }
    }
  }
  // The unfinished last leg runs to the current extreme.
  if (dir !== 0) pivots.push({ index: ext, value: dir === 1 ? candles[ext].high : candles[ext].low });
  const out = new Array(candles.length).fill(null);
  for (let p = 1; p < pivots.length; p++) {
    const a = pivots[p - 1], b = pivots[p];
    for (let k = a.index; k <= b.index; k++) out[k] = b.index === a.index ? a.value : a.value + (b.value - a.value) * (k - a.index) / (b.index - a.index);
  }
  return out;
}
export function chandeKroll(candles, { p, x, q }) {
  const atr = rmaArr(trueRangeArr(candles), p);
  const firstHigh = combine(highestArr(highs(candles), p), atr, (h, a) => h - x * a);
  const firstLow = combine(lowestArr(lows(candles), p), atr, (l, a) => l + x * a);
  const win = (arr, fn) => arr.map((_, i) => { if (i < q - 1) return null; const w = arr.slice(i - q + 1, i + 1); return w.some(v => v === null) ? null : fn(...w); });
  return { short: win(firstHigh, Math.max), long: win(firstLow, Math.min) };
}
/** Linear regression channel over the last `length` bars only (like TradingView's drawing). */
export function linregChannel(candles, { length, deviation }) {
  const n = Math.min(length, candles.length), start = candles.length - n, x = closes(candles);
  const mid = new Array(candles.length).fill(null), upper = mid.slice(), lower = mid.slice();
  if (n < 2) return { mid, upper, lower };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) { const v = x[start + k]; sx += k; sy += v; sxy += k * v; sxx += k * k; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), intercept = (sy - slope * sx) / n;
  let dev = 0;
  for (let k = 0; k < n; k++) dev += (x[start + k] - (intercept + slope * k)) ** 2;
  dev = Math.sqrt(dev / n);
  for (let k = 0; k < n; k++) { const m = intercept + slope * k; mid[start + k] = m; upper[start + k] = m + deviation * dev; lower[start + k] = m - deviation * dev; }
  return { mid, upper, lower };
}
export function vwapBands(candles, mult) {
  let day = null, pv = 0, v = 0, pv2 = 0;
  const mid = [], upper = [], lower = [];
  for (const c of candles) {
    const d = Math.floor(c.time / 86400);
    if (d !== day) { day = d; pv = 0; v = 0; pv2 = 0; }
    if (!isNum(c.volume) || c.volume < 0) { mid.push(null); upper.push(null); lower.push(null); continue; }
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume; v += c.volume; pv2 += tp * tp * c.volume;
    const w = v > 0 ? pv / v : null, sd = w === null ? null : Math.sqrt(Math.max(0, pv2 / v - w * w));
    mid.push(w); upper.push(w === null ? null : w + mult * sd); lower.push(w === null ? null : w - mult * sd);
  }
  return { mid, upper, lower };
}

// ---------- more oscillators ----------
export function ppo(candles, { fast, slow, signal }) {
  const x = closes(candles), f = emaArr(x, fast), s = emaArr(x, slow);
  const line = combine(f, s, (a, b) => b === 0 ? null : (a - b) / b * 100), sig = emaArr(line, signal);
  return { line, signal: sig, hist: combine(line, sig, (a, b) => a - b) };
}
export function trix(candles, n) {
  const e = emaArr(emaArr(emaArr(closes(candles).map(Math.log), n), n), n);
  return changeArr(e).map(v => v === null ? null : v * 10000);
}
/** True Strength Index (×100): double-smoothed momentum. */
export function tsi(candles, long, short) {
  const pc = changeArr(closes(candles)), apc = pc.map(v => v === null ? null : Math.abs(v));
  const a = emaArr(emaArr(pc, long), short), b = emaArr(emaArr(apc, long), short);
  return combine(a, b, (x, y) => y === 0 ? 0 : 100 * x / y);
}
export function ultimateOscillator(candles, { fast, middle, slow }) {
  const bp = candles.map((c, i) => i === 0 ? null : c.close - Math.min(c.low, candles[i - 1].close));
  const tr = candles.map((c, i) => i === 0 ? null : Math.max(c.high, candles[i - 1].close) - Math.min(c.low, candles[i - 1].close));
  const avg = n => combine(sumArr(bp, n), sumArr(tr, n), (a, b) => b === 0 ? 0 : a / b);
  const a1 = avg(fast), a2 = avg(middle), a3 = avg(slow);
  return a1.map((v, i) => v === null || a2[i] === null || a3[i] === null ? null : 100 * (4 * v + 2 * a2[i] + a3[i]) / 7);
}
export const awesome = candles => combine(smaArr(hl2(candles), 5), smaArr(hl2(candles), 34), (a, b) => a - b);
export function cmo(candles, n) {
  const ch = changeArr(closes(candles));
  const up = sumArr(ch.map(v => v === null ? null : Math.max(v, 0)), n), down = sumArr(ch.map(v => v === null ? null : Math.max(-v, 0)), n);
  return combine(up, down, (u, d) => u + d === 0 ? 0 : 100 * (u - d) / (u + d));
}
export function dpo(candles, n) {
  const ma = smaArr(closes(candles), n), back = Math.floor(n / 2) + 1;
  return candles.map((c, i) => i < back || ma[i - back] === null ? null : c.close - ma[i - back]);
}
export function fisher(candles, n) {
  const src = hl2(candles), hi = highestArr(src, n), lo = lowestArr(src, n);
  const fish = new Array(candles.length).fill(null), trigger = fish.slice();
  let value = 0, prevFish = 0, started = false;
  for (let i = 0; i < src.length; i++) {
    if (hi[i] === null) continue;
    const range = hi[i] - lo[i];
    value = Math.max(-0.999, Math.min(0.999, 0.66 * ((range === 0 ? 0.5 : (src[i] - lo[i]) / range) - 0.5) + 0.67 * value));
    const f = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * prevFish;
    if (started) trigger[i] = prevFish;
    fish[i] = f; prevFish = f; started = true;
  }
  return { fish, trigger };
}
const rocArr = (x, n) => x.map((v, i) => i < n || !x[i - n] ? null : 100 * (v / x[i - n] - 1));
export function kst(candles) {
  const x = closes(candles), part = (r, s, w) => smaArr(rocArr(x, r), s).map(v => v === null ? null : v * w);
  const parts = [part(10, 10, 1), part(15, 10, 2), part(20, 10, 3), part(30, 15, 4)];
  const line = x.map((_, i) => parts.some(p => p[i] === null) ? null : parts.reduce((s, p) => s + p[i], 0));
  return { line, signal: smaArr(line, 9) };
}
export function coppock(candles, { wmaLength, longRoc, shortRoc }) {
  const x = closes(candles);
  return wmaArr(combine(rocArr(x, longRoc), rocArr(x, shortRoc), (a, b) => a + b), wmaLength);
}
const swma = x => x.map((v, i) => i < 3 || [0, 1, 2, 3].some(k => !isNum(x[i - k])) ? null : (x[i - 3] + 2 * x[i - 2] + 2 * x[i - 1] + v) / 6);
export function rvgi(candles, n) {
  const num = swma(candles.map(c => c.close - c.open)), den = swma(candles.map(c => c.high - c.low));
  const line = combine(sumArr(num, n), sumArr(den, n), (a, b) => b === 0 ? 0 : a / b);
  return { line, signal: swma(line) };
}
export function schaff(candles, { length, fast, slow }) {
  const x = closes(candles), macd = combine(emaArr(x, fast), emaArr(x, slow), (a, b) => a - b);
  const stage = values => {
    const lo = lowestArr(values.map(v => v ?? NaN), length), hi = highestArr(values.map(v => v ?? NaN), length);
    const out = new Array(values.length).fill(null);
    let f = null, smooth = null;
    for (let i = 0; i < values.length; i++) {
      if (values[i] === null || !isNum(lo[i]) || !isNum(hi[i])) continue;
      const range = hi[i] - lo[i];
      f = range > 0 ? (values[i] - lo[i]) / range * 100 : (f ?? 0);
      smooth = smooth === null ? f : smooth + 0.5 * (f - smooth);
      out[i] = smooth;
    }
    return out;
  };
  return stage(stage(macd));
}
export function connorsRsi(candles, { rsiLength, streakLength, rankLength }) {
  const x = closes(candles), streak = [];
  x.forEach((v, i) => {
    const prev = streak[i - 1] ?? 0;
    streak.push(i === 0 ? 0 : v > x[i - 1] ? (prev > 0 ? prev + 1 : 1) : v < x[i - 1] ? (prev < 0 ? prev - 1 : -1) : 0);
  });
  const r1 = rsiArr(x, rsiLength), r2 = rsiArr(streak, streakLength), roc1 = rocArr(x, 1);
  const rank = roc1.map((v, i) => {
    if (v === null || i < rankLength + 1) return null;
    let count = 0;
    for (let k = 1; k <= rankLength; k++) if (roc1[i - k] !== null && roc1[i - k] <= v) count++;
    return 100 * count / rankLength;
  });
  return x.map((_, i) => r1[i] === null || r2[i] === null || rank[i] === null ? null : (r1[i] + r2[i] + rank[i]) / 3);
}
export function waveTrend(candles, { channel, average }) {
  const ap = typical(candles), esa = emaArr(ap, channel);
  const d = emaArr(combine(ap, esa, (a, e) => Math.abs(a - e)), channel);
  const ci = ap.map((a, i) => esa[i] === null || d[i] === null || d[i] === 0 ? null : (a - esa[i]) / (0.015 * d[i]));
  const wt1 = emaArr(ci, average);
  return { wt1, wt2: smaArr(wt1, 4) };
}
export function squeeze(candles, { length, bbMult, kcMult }) {
  const x = closes(candles), bb = bollinger(candles, length, bbMult);
  const ma = smaArr(x, length), rangeMa = smaArr(trueRangeArr(candles), length);
  const hh = highestArr(highs(candles), length), ll = lowestArr(lows(candles), length);
  const on = x.map((_, i) => bb.lower[i] === null || rangeMa[i] === null ? null : bb.lower[i] > ma[i] - rangeMa[i] * kcMult && bb.upper[i] < ma[i] + rangeMa[i] * kcMult);
  const delta = x.map((v, i) => hh[i] === null || ma[i] === null ? null : v - ((hh[i] + ll[i]) / 2 + ma[i]) / 2);
  return { value: linregArr(delta, length), on };
}
export function aroon(candles, n) {
  const up = new Array(candles.length).fill(null), down = up.slice();
  for (let i = n; i < candles.length; i++) {
    let hiAt = i, loAt = i;
    for (let k = i - n; k <= i; k++) { if (candles[k].high > candles[hiAt].high) hiAt = k; if (candles[k].low < candles[loAt].low) loAt = k; }
    up[i] = 100 * (n - (i - hiAt)) / n; down[i] = 100 * (n - (i - loAt)) / n;
  }
  return { up, down };
}
export function vortex(candles, n) {
  const vp = candles.map((c, i) => i === 0 ? null : Math.abs(c.high - candles[i - 1].low));
  const vm = candles.map((c, i) => i === 0 ? null : Math.abs(c.low - candles[i - 1].high));
  const tr = sumArr(trueRangeArr(candles).map((v, i) => i === 0 ? null : v), n);
  return { plus: combine(sumArr(vp, n), tr, (a, b) => b === 0 ? null : a / b), minus: combine(sumArr(vm, n), tr, (a, b) => b === 0 ? null : a / b) };
}
export function choppiness(candles, n) {
  const atrSum = sumArr(trueRangeArr(candles), n), hh = highestArr(highs(candles), n), ll = lowestArr(lows(candles), n);
  return atrSum.map((s, i) => s === null || hh[i] === null || hh[i] === ll[i] ? null : 100 * Math.log10(s / (hh[i] - ll[i])) / Math.log10(n));
}
export function massIndex(candles, n) {
  const span = candles.map(c => c.high - c.low), e1 = emaArr(span, 9), e2 = emaArr(e1, 9);
  return sumArr(combine(e1, e2, (a, b) => b === 0 ? null : a / b), n);
}
export function historicalVolatility(candles, n) {
  const logRet = candles.map((c, i) => i === 0 || !(candles[i - 1].close > 0) ? null : Math.log(c.close / candles[i - 1].close));
  const barsPerYear = 365 * 86400 / stepSeconds(candles);
  return stdevArr(logRet, n).map(v => v === null ? null : 100 * v * Math.sqrt(barsPerYear));
}
export function ulcerIndex(candles, n) {
  const x = closes(candles), hh = highestArr(x, n);
  const dd = x.map((v, i) => hh[i] === null ? null : (100 * (v - hh[i]) / hh[i]) ** 2);
  return sumArr(dd, n).map(v => v === null ? null : Math.sqrt(v / n));
}
export function relativeVolatility(candles, { length, smoothing }) {
  const x = closes(candles), sd = stdevArr(x, length), ch = changeArr(x);
  const up = emaArr(x.map((_, i) => sd[i] === null || ch[i] === null ? null : ch[i] <= 0 ? 0 : sd[i]), smoothing);
  const down = emaArr(x.map((_, i) => sd[i] === null || ch[i] === null ? null : ch[i] > 0 ? 0 : sd[i]), smoothing);
  return combine(up, down, (u, d) => u + d === 0 ? 50 : 100 * u / (u + d));
}

// ---------- more volume ----------
export function accumulationDistribution(candles) {
  let total = 0;
  return candles.map(c => {
    if (!isNum(c.volume)) return null;
    total += c.high === c.low ? 0 : ((c.close - c.low) - (c.high - c.close)) / (c.high - c.low) * c.volume;
    return total;
  });
}
export function priceVolumeTrend(candles) {
  let total = 0;
  return candles.map((c, i) => {
    if (!isNum(c.volume)) return null;
    if (i > 0 && candles[i - 1].close) total += (c.close - candles[i - 1].close) / candles[i - 1].close * c.volume;
    return total;
  });
}
export function easeOfMovement(candles, { length, divisor }) {
  const mid = hl2(candles), ch = changeArr(mid);
  return smaArr(candles.map((c, i) => ch[i] === null || !(c.volume > 0) ? null : divisor * ch[i] * (c.high - c.low) / c.volume), length);
}
export const forceIndex = (candles, n) => emaArr(changeArr(closes(candles)).map((v, i) => v === null || !isNum(candles[i].volume) ? null : v * candles[i].volume), n);
export function klinger(candles, { fast, slow, signal }) {
  const ch = changeArr(typical(candles)), sv = candles.map((c, i) => ch[i] === null || !isNum(c.volume) ? null : ch[i] >= 0 ? c.volume : -c.volume);
  const kvo = combine(emaArr(sv, fast), emaArr(sv, slow), (a, b) => a - b);
  return { kvo, signal: emaArr(kvo, signal) };
}
export function volumeOscillator(candles, { short, long }) {
  const v = volumes(candles);
  return combine(emaArr(v, short), emaArr(v, long), (a, b) => b === 0 ? null : 100 * (a - b) / b);
}
export const netVolume = candles => candles.map((c, i) => !isNum(c.volume) || i === 0 ? null : c.close > candles[i - 1].close ? c.volume : c.close < candles[i - 1].close ? -c.volume : 0);

// ---------- registry ----------
const P = (key, label, def, min, max, step = 1) => ({ key, label, default: def, min, max, step });
const line = (key, label, color, data, extra = {}) => ({ key, label, color, type: "line", width: 1, data, ...extra });

export const EXTRA_INDICATORS = [
  // ---- Overlays ----
  { id: "wma", label: "WMA", group: "Moving averages", placement: "overlay", params: [P("length", "Length", 20, 2, 500)],
    compute: (c, p) => ({ series: [line("wma", "WMA", "#c792ea", pts(c, wmaArr(closes(c), p.length)), { width: 2 })] }) },
  { id: "hma", label: "Hull MA", group: "Moving averages", placement: "overlay", params: [P("length", "Length", 9, 2, 500)],
    compute: (c, p) => {
      const x = closes(c), half = wmaArr(x, Math.max(1, Math.floor(p.length / 2))), full = wmaArr(x, p.length);
      const diff = half.map((h, i) => h === null || full[i] === null ? null : 2 * h - full[i]);
      return { series: [line("hma", "Hull MA", "#f78c6c", pts(c, wmaArr(diff, Math.max(1, Math.round(Math.sqrt(p.length))))), { width: 2 })] };
    } },
  { id: "vwap", label: "VWAP (daily)", group: "Moving averages", placement: "overlay", params: [],
    compute: c => ({ series: [line("vwap", "VWAP", "#4fc1ff", pts(c, vwap(c)), { width: 2 })] }) },
  { id: "keltner", label: "Keltner Channels", group: "Bands & channels", placement: "overlay",
    params: [P("length", "EMA length", 20, 2, 500), P("multiplier", "Multiplier", 2, 0.1, 10, 0.1), P("atrLength", "ATR length", 10, 1, 500)],
    compute: (c, p) => {
      const k = keltner(c, p);
      return { series: [line("upper", "Upper", "#5ab0c6", pts(c, k.upper)), line("mid", "Basis", "#5ab0c6", pts(c, k.mid), { dashed: true }),
        line("lower", "Lower", "#5ab0c6", pts(c, k.lower))], fills: [{ upper: "upper", lower: "lower", up: "rgba(90,176,198,0.08)", down: "rgba(90,176,198,0.08)" }] };
    } },
  { id: "donchian", label: "Donchian Channels", group: "Bands & channels", placement: "overlay", params: [P("length", "Length", 20, 2, 500)],
    compute: (c, p) => {
      const d = donchian(c, p);
      return { series: [line("upper", "Upper", "#58a6ff", pts(c, d.upper)), line("mid", "Basis", "#ff9e64", pts(c, d.mid)),
        line("lower", "Lower", "#58a6ff", pts(c, d.lower))], fills: [{ upper: "upper", lower: "lower", up: "rgba(88,166,255,0.07)", down: "rgba(88,166,255,0.07)" }] };
    } },
  { id: "ichimoku", label: "Ichimoku Cloud", group: "Trend", placement: "overlay",
    params: [P("conversion", "Conversion line", 9, 1, 200), P("base", "Base line", 26, 1, 200), P("spanB", "Leading span B", 52, 1, 400), P("displacement", "Displacement", 26, 1, 200)],
    compute: (c, p) => {
      const ich = ichimoku(c, p);
      return { series: [
        line("tenkan", "Conversion", "#2962ff", pts(c, ich.tenkan)), line("kijun", "Base", "#b71c1c", pts(c, ich.kijun)),
        line("chikou", "Lagging", "#43a047", ich.chikou),
        line("senkouA", "Lead A", "#4caf50", ich.senkouA.map(x => ({ time: x.time, value: x.value }))),
        line("senkouB", "Lead B", "#f44336", ich.senkouB.map(x => ({ time: x.time, value: x.value }))),
      ], fills: [{ upper: "senkouA", lower: "senkouB", up: "rgba(76,175,80,0.16)", down: "rgba(244,67,54,0.16)" }] };
    } },
  { id: "supertrend", label: "Supertrend", group: "Trend", placement: "overlay",
    params: [P("atrLength", "ATR length", 10, 1, 500), P("factor", "Factor", 3, 0.1, 20, 0.1)],
    compute: (c, p) => {
      const st = supertrend(c, p);
      return { series: [
        line("up", "Up trend", "#26a69a", pts(c, st.line.map((v, i) => st.dir[i] === -1 ? v : null)), { width: 2 }),
        line("down", "Down trend", "#ef5350", pts(c, st.line.map((v, i) => st.dir[i] === 1 ? v : null)), { width: 2 }),
      ] };
    } },
  { id: "psar", label: "Parabolic SAR", group: "Trend", placement: "overlay",
    params: [P("start", "Start", 0.02, 0.001, 1, 0.001), P("increment", "Increment", 0.02, 0.001, 1, 0.001), P("maximum", "Maximum", 0.2, 0.01, 1, 0.01)],
    compute: (c, p) => ({ series: [{ key: "sar", label: "SAR", color: "#2196f3", type: "dots", data: pts(c, psar(c, p).sar) }] }) },
  // ---- Oscillators / panes ----
  { id: "stoch", label: "Stochastic", group: "Oscillators", placement: "pane", paneHeight: 110,
    params: [P("kLength", "%K length", 14, 1, 500), P("kSmoothing", "%K smoothing", 1, 1, 50), P("dSmoothing", "%D smoothing", 3, 1, 50)],
    compute: (c, p) => { const s = stochastic(c, p);
      return { series: [line("k", "%K", "#2962ff", pts(c, s.k)), line("d", "%D", "#ff6d00", pts(c, s.d))], levels: [{ value: 80 }, { value: 20 }], range: [0, 100] }; } },
  { id: "stochrsi", label: "Stochastic RSI", group: "Oscillators", placement: "pane", paneHeight: 110,
    params: [P("rsiLength", "RSI length", 14, 2, 500), P("stochLength", "Stoch length", 14, 1, 500), P("kSmoothing", "K", 3, 1, 50), P("dSmoothing", "D", 3, 1, 50)],
    compute: (c, p) => { const s = stochRsi(c, p);
      return { series: [line("k", "K", "#2962ff", pts(c, s.k)), line("d", "D", "#ff6d00", pts(c, s.d))], levels: [{ value: 80 }, { value: 20 }], range: [0, 100] }; } },
  { id: "cci", label: "CCI", group: "Oscillators", placement: "pane", paneHeight: 110, params: [P("length", "Length", 20, 2, 500)],
    compute: (c, p) => ({ series: [line("cci", "CCI", "#ab47bc", pts(c, cci(c, p)), { width: 2 })], levels: [{ value: 100 }, { value: 0 }, { value: -100 }] }) },
  { id: "willr", label: "Williams %R", group: "Oscillators", placement: "pane", paneHeight: 110, params: [P("length", "Length", 14, 2, 500)],
    compute: (c, p) => ({ series: [line("wr", "%R", "#7e57c2", pts(c, williamsR(c, p)), { width: 2 })], levels: [{ value: -20 }, { value: -80 }], range: [-100, 0] }) },
  { id: "roc", label: "Rate of Change", group: "Oscillators", placement: "pane", paneHeight: 100, params: [P("length", "Length", 9, 1, 500)],
    compute: (c, p) => ({ series: [line("roc", "ROC %", "#26a69a", pts(c, roc(c, p)), { width: 2 })], levels: [{ value: 0 }] }) },
  { id: "adx", label: "ADX / DMI", group: "Trend strength & volatility", placement: "pane", paneHeight: 120, params: [P("length", "Length", 14, 2, 500)],
    compute: (c, p) => { const a = adx(c, p);
      return { series: [line("adx", "ADX", "#ff9800", pts(c, a.adx), { width: 2 }), line("plus", "+DI", "#26a69a", pts(c, a.plusDI)), line("minus", "−DI", "#ef5350", pts(c, a.minusDI))],
        levels: [{ value: 25 }] }; } },
  { id: "atr", label: "ATR", group: "Trend strength & volatility", placement: "pane", paneHeight: 100, params: [P("length", "Length", 14, 1, 500)],
    compute: (c, p) => ({ series: [line("atr", "ATR", "#b71c1c", pts(c, rmaArr(trueRangeArr(c), p.length)), { width: 2 })] }) },
  { id: "mfi", label: "Money Flow Index", group: "Volume", placement: "pane", paneHeight: 110, params: [P("length", "Length", 14, 2, 500)],
    compute: (c, p) => ({ series: [line("mfi", "MFI", "#7e57c2", pts(c, mfi(c, p)), { width: 2 })], levels: [{ value: 80 }, { value: 20 }], range: [0, 100] }) },
  { id: "obv", label: "On-Balance Volume", group: "Volume", placement: "pane", paneHeight: 110, params: [],
    compute: c => ({ series: [line("obv", "OBV", "#2196f3", pts(c, obv(c)), { width: 2 })] }) },
  { id: "cmf", label: "Chaikin Money Flow", group: "Volume", placement: "pane", paneHeight: 100, params: [P("length", "Length", 20, 2, 500)],
    compute: (c, p) => ({ series: [{ key: "cmf", label: "CMF", color: "#43a047", type: "histogram", data: pts(c, cmf(c, p)) }], levels: [{ value: 0 }] }) },
  // ======== More indicators (most used built-ins + popular community scripts) ========
  // ---- Moving averages ----
  { id: "dema", label: "DEMA", group: "Moving averages", placement: "overlay", params: [P("length", "Length", 9, 2, 500)],
    compute: (c, p) => ({ series: [line("dema", "DEMA", "#43a047", pts(c, demaArr(closes(c), p.length)), { width: 2 })] }) },
  { id: "tema", label: "TEMA", group: "Moving averages", placement: "overlay", params: [P("length", "Length", 9, 2, 500)],
    compute: (c, p) => ({ series: [line("tema", "TEMA", "#e91e63", pts(c, temaArr(closes(c), p.length)), { width: 2 })] }) },
  { id: "smma", label: "SMMA (RMA)", group: "Moving averages", placement: "overlay", params: [P("length", "Length", 7, 2, 500)],
    compute: (c, p) => ({ series: [line("smma", "SMMA", "#673ab7", pts(c, rmaArr(closes(c), p.length)), { width: 2 })] }) },
  { id: "vwma", label: "VWMA", group: "Moving averages", placement: "overlay", params: [P("length", "Length", 20, 2, 500)],
    compute: (c, p) => ({ series: [line("vwma", "VWMA", "#2196f3", pts(c, vwmaArr(c, p.length)), { width: 2 })] }) },
  { id: "alma", label: "ALMA (Arnaud Legoux)", group: "Moving averages", placement: "overlay",
    params: [P("length", "Length", 9, 2, 500), P("offset", "Offset", 0.85, 0, 1, 0.01), P("sigma", "Sigma", 6, 0.5, 20, 0.5)],
    compute: (c, p) => ({ series: [line("alma", "ALMA", "#00bcd4", pts(c, almaArr(closes(c), p.length, p.offset, p.sigma)), { width: 2 })] }) },
  { id: "kama", label: "KAMA (Kaufman Adaptive)", group: "Moving averages", placement: "overlay",
    params: [P("length", "Length", 10, 2, 500), P("fast", "Fast", 2, 1, 100), P("slow", "Slow", 30, 2, 500)],
    compute: (c, p) => ({ series: [line("kama", "KAMA", "#ff9800", pts(c, kamaArr(closes(c), p.length, p.fast, p.slow)), { width: 2 })] }) },
  { id: "zlema", label: "Zero Lag EMA", group: "Moving averages", placement: "overlay", params: [P("length", "Length", 21, 2, 500)],
    compute: (c, p) => ({ series: [line("zlema", "ZLEMA", "#ffeb3b", pts(c, zlemaArr(closes(c), p.length)), { width: 2 })] }) },
  { id: "lsma", label: "Least Squares MA", group: "Moving averages", placement: "overlay", params: [P("length", "Length", 25, 2, 500)],
    compute: (c, p) => ({ series: [line("lsma", "LSMA", "#9c27b0", pts(c, linregArr(closes(c), p.length)), { width: 2 })] }) },
  { id: "mcginley", label: "McGinley Dynamic", group: "Moving averages", placement: "overlay", params: [P("length", "Length", 14, 2, 500)],
    compute: (c, p) => ({ series: [line("md", "McGinley", "#4db6ac", pts(c, mcginleyArr(closes(c), p.length)), { width: 2 })] }) },
  { id: "t3", label: "T3 (Tillson)", group: "Moving averages", placement: "overlay",
    params: [P("length", "Length", 5, 1, 200), P("vfactor", "Volume factor", 0.7, 0, 1, 0.05)],
    compute: (c, p) => ({ series: [line("t3", "T3", "#f06292", pts(c, t3Arr(closes(c), p.length, p.vfactor)), { width: 2 })] }) },
  { id: "maribbon", label: "EMA Ribbon (20/50/100/200)", group: "Moving averages", placement: "overlay", params: [],
    compute: c => { const x = closes(c); return { series: [
      line("e20", "EMA 20", "#f5d76e", pts(c, emaArr(x, 20))), line("e50", "EMA 50", "#ff9800", pts(c, emaArr(x, 50))),
      line("e100", "EMA 100", "#f44336", pts(c, emaArr(x, 100))), line("e200", "EMA 200", "#2962ff", pts(c, emaArr(x, 200)), { width: 2 })] }; } },
  { id: "macross", label: "MA Cross (50/200)", group: "Moving averages", placement: "overlay",
    params: [P("fast", "Fast SMA", 50, 2, 500), P("slow", "Slow SMA", 200, 2, 1000)],
    compute: (c, p) => { const x = closes(c); return { series: [line("fast", "Fast", "#43a047", pts(c, smaArr(x, p.fast)), { width: 2 }), line("slow", "Slow", "#e53935", pts(c, smaArr(x, p.slow)), { width: 2 })] }; } },
  { id: "alligator", label: "Williams Alligator", group: "Moving averages", placement: "overlay", params: [],
    compute: c => { const src = hl2(c); return { series: [
      line("jaw", "Jaw", "#2962ff", aheadPts(c, rmaArr(src, 13), 8)), line("teeth", "Teeth", "#e91e63", aheadPts(c, rmaArr(src, 8), 5)),
      line("lips", "Lips", "#66bb6a", aheadPts(c, rmaArr(src, 5), 3))] }; } },
  // ---- Bands & channels ----
  { id: "envelope", label: "Envelopes", group: "Bands & channels", placement: "overlay",
    params: [P("length", "Length", 20, 2, 500), P("percent", "Percent", 10, 0.1, 50, 0.1)],
    compute: (c, p) => { const b = smaArr(closes(c), p.length);
      return { series: [line("upper", "Upper", "#2196f3", pts(c, b.map(v => v === null ? null : v * (1 + p.percent / 100)))),
        line("basis", "Basis", "#ff6d00", pts(c, b)), line("lower", "Lower", "#2196f3", pts(c, b.map(v => v === null ? null : v * (1 - p.percent / 100))))],
        fills: [{ upper: "upper", lower: "lower", up: "rgba(33,150,243,0.06)", down: "rgba(33,150,243,0.06)" }] }; } },
  { id: "vwapbands", label: "VWAP + Bands", group: "Bands & channels", placement: "overlay", params: [P("multiplier", "Band multiplier", 2, 0.1, 5, 0.1)],
    compute: (c, p) => { const v = vwapBands(c, p.multiplier);
      return { series: [line("upper", "Upper", "#4caf50", pts(c, v.upper)), line("vwap", "VWAP", "#2962ff", pts(c, v.mid), { width: 2 }), line("lower", "Lower", "#4caf50", pts(c, v.lower))],
        fills: [{ upper: "upper", lower: "lower", up: "rgba(76,175,80,0.07)", down: "rgba(76,175,80,0.07)" }] }; } },
  { id: "linreg", label: "Linear Regression Channel", group: "Bands & channels", placement: "overlay",
    params: [P("length", "Length", 100, 10, 1000), P("deviation", "Deviation", 2, 0.1, 5, 0.1)],
    compute: (c, p) => { const l = linregChannel(c, p);
      return { series: [line("upper", "Upper", "#e53935", pts(c, l.upper)), line("mid", "Regression", "#2962ff", pts(c, l.mid), { width: 2 }), line("lower", "Lower", "#43a047", pts(c, l.lower))],
        fills: [{ upper: "upper", lower: "lower", up: "rgba(41,98,255,0.06)", down: "rgba(41,98,255,0.06)" }] }; } },
  // ---- Support & resistance ----
  { id: "pivots", label: "Pivot Points Standard", group: "Support & resistance", placement: "overlay", params: [],
    compute: c => { const pv = pivotPoints(c);
      const col = { p: "#ff9800", r1: "#ef5350", r2: "#ef5350", r3: "#ef5350", s1: "#26a69a", s2: "#26a69a", s3: "#26a69a" };
      return { series: Object.keys(col).map(k => line(k, k.toUpperCase(), col[k], pts(c, pv[k]), { step: true, dashed: k !== "p" })) }; } },
  { id: "fractals", label: "Williams Fractals", group: "Support & resistance", placement: "overlay", params: [P("periods", "Periods", 2, 1, 20)],
    compute: (c, p) => { const f = fractals(c, p.periods);
      return { series: [{ key: "up", label: "Fractal high", color: "#ef5350", type: "dots", data: pts(c, f.up) },
        { key: "down", label: "Fractal low", color: "#26a69a", type: "dots", data: pts(c, f.down) }] }; } },
  { id: "zigzag", label: "ZigZag", group: "Support & resistance", placement: "overlay",
    params: [P("deviation", "Deviation %", 5, 0.1, 50, 0.1), P("depth", "Depth", 10, 1, 200)],
    compute: (c, p) => ({ series: [line("zz", "ZigZag", "#2962ff", pts(c, zigzag(c, p)), { width: 2 })] }) },
  { id: "chandelier", label: "Chandelier Exit", group: "Trend", placement: "overlay",
    params: [P("length", "ATR length", 22, 1, 500), P("multiplier", "Multiplier", 3, 0.1, 20, 0.1)],
    compute: (c, p) => { const ce = chandelierExit(c, p);
      return { series: [line("long", "Long stop", "#26a69a", pts(c, ce.long), { width: 2 }), line("short", "Short stop", "#ef5350", pts(c, ce.short), { width: 2 })] }; } },
  { id: "volstop", label: "Volatility Stop", group: "Trend", placement: "overlay",
    params: [P("length", "Length", 20, 1, 500), P("multiplier", "Multiplier", 2, 0.1, 20, 0.1)],
    compute: (c, p) => { const v = volatilityStop(c, p);
      return { series: [{ key: "up", label: "Stop (up)", color: "#26a69a", type: "dots", data: pts(c, v.up) }, { key: "down", label: "Stop (down)", color: "#ef5350", type: "dots", data: pts(c, v.down) }] }; } },
  { id: "chandekroll", label: "Chande Kroll Stop", group: "Trend", placement: "overlay",
    params: [P("p", "ATR length", 10, 1, 200), P("x", "Multiplier", 1, 0.1, 10, 0.1), P("q", "Stop length", 9, 1, 200)],
    compute: (c, p) => { const k = chandeKroll(c, p);
      return { series: [line("long", "Stop long", "#26a69a", pts(c, k.long)), line("short", "Stop short", "#ef5350", pts(c, k.short))] }; } },
  // ---- Popular community oscillators ----
  { id: "squeeze", label: "Squeeze Momentum (LazyBear)", group: "Oscillators", placement: "pane", paneHeight: 120,
    params: [P("length", "Length", 20, 2, 500), P("bbMult", "BB multiplier", 2, 0.1, 10, 0.1), P("kcMult", "KC multiplier", 1.5, 0.1, 10, 0.1)],
    compute: (c, p) => { const s = squeeze(c, p);
      const data = pts(c, s.value).map((pt, i) => pt.value === null ? pt : { ...pt,
        color: pt.value >= 0 ? (s.value[i - 1] !== null && pt.value > s.value[i - 1] ? "#00e676" : "#1b7f4b") : (s.value[i - 1] !== null && pt.value < s.value[i - 1] ? "#ff1744" : "#8b1a1a") });
      return { series: [{ key: "mom", label: "Momentum", color: "#00e676", type: "histogram", data },
        { key: "on", label: "Squeeze on", color: "#ef5350", type: "dots", data: pts(c, s.on.map(v => v === true ? 0 : null)) },
        { key: "off", label: "Squeeze off", color: "#9e9e9e", type: "dots", data: pts(c, s.on.map(v => v === false ? 0 : null)) }] }; } },
  { id: "wavetrend", label: "WaveTrend (LazyBear)", group: "Oscillators", placement: "pane", paneHeight: 120,
    params: [P("channel", "Channel length", 10, 1, 200), P("average", "Average length", 21, 1, 200)],
    compute: (c, p) => { const w = waveTrend(c, p);
      return { series: [line("wt1", "WT1", "#26a69a", pts(c, w.wt1), { width: 2 }), line("wt2", "WT2", "#ef5350", pts(c, w.wt2))],
        levels: [{ value: 60 }, { value: 0 }, { value: -60 }] }; } },
  // ---- Classic oscillators ----
  { id: "momentum", label: "Momentum", group: "Oscillators", placement: "pane", paneHeight: 100, params: [P("length", "Length", 10, 1, 500)],
    compute: (c, p) => ({ series: [line("mom", "MOM", "#2196f3", pts(c, changeArr(closes(c), p.length)), { width: 2 })], levels: [{ value: 0 }] }) },
  { id: "ao", label: "Awesome Oscillator", group: "Oscillators", placement: "pane", paneHeight: 110, params: [],
    compute: c => { const ao = awesome(c);
      return { series: [{ key: "ao", label: "AO", color: "#26a69a", type: "histogram",
        data: pts(c, ao).map((pt, i) => pt.value === null ? pt : { ...pt, color: ao[i - 1] !== null && pt.value >= ao[i - 1] ? "#26a69a" : "#ef5350" }) }] }; } },
  { id: "ac", label: "Accelerator Oscillator", group: "Oscillators", placement: "pane", paneHeight: 110, params: [],
    compute: c => { const ao = awesome(c), sma = smaArr(ao, 5), ac = combine(ao, sma, (a, b) => a - b);
      return { series: [{ key: "ac", label: "AC", color: "#26a69a", type: "histogram",
        data: pts(c, ac).map((pt, i) => pt.value === null ? pt : { ...pt, color: ac[i - 1] !== null && pt.value >= ac[i - 1] ? "#26a69a" : "#ef5350" }) }] }; } },
  { id: "ppo", label: "PPO", group: "Oscillators", placement: "pane", paneHeight: 110,
    params: [P("fast", "Fast", 12, 1, 200), P("slow", "Slow", 26, 2, 400), P("signal", "Signal", 9, 1, 100)],
    compute: (c, p) => { const r = ppo(c, p);
      return { series: [{ key: "hist", label: "Histogram", color: "#26a69a", type: "histogram", data: pts(c, r.hist) },
        line("ppo", "PPO", "#2962ff", pts(c, r.line), { width: 2 }), line("signal", "Signal", "#ff6d00", pts(c, r.signal))], levels: [{ value: 0 }] }; } },
  { id: "trix", label: "TRIX", group: "Oscillators", placement: "pane", paneHeight: 100, params: [P("length", "Length", 18, 1, 200)],
    compute: (c, p) => ({ series: [line("trix", "TRIX", "#e91e63", pts(c, trix(c, p.length)), { width: 2 })], levels: [{ value: 0 }] }) },
  { id: "tsi", label: "True Strength Index", group: "Oscillators", placement: "pane", paneHeight: 110,
    params: [P("long", "Long", 25, 1, 200), P("short", "Short", 13, 1, 200), P("signal", "Signal", 13, 1, 100)],
    compute: (c, p) => { const t = tsi(c, p.long, p.short);
      return { series: [line("tsi", "TSI", "#2962ff", pts(c, t), { width: 2 }), line("signal", "Signal", "#e91e63", pts(c, emaArr(t, p.signal)))], levels: [{ value: 0 }] }; } },
  { id: "smiergodic", label: "SMI Ergodic", group: "Oscillators", placement: "pane", paneHeight: 110,
    params: [P("long", "Long", 20, 1, 200), P("short", "Short", 5, 1, 200), P("signal", "Signal", 5, 1, 100)],
    compute: (c, p) => { const t = tsi(c, p.long, p.short).map(v => v === null ? null : v / 100);
      return { series: [line("smi", "SMI", "#2962ff", pts(c, t), { width: 2 }), line("signal", "Signal", "#ff6d00", pts(c, emaArr(t, p.signal)))], levels: [{ value: 0 }] }; } },
  { id: "uo", label: "Ultimate Oscillator", group: "Oscillators", placement: "pane", paneHeight: 110,
    params: [P("fast", "Fast", 7, 1, 100), P("middle", "Middle", 14, 1, 200), P("slow", "Slow", 28, 1, 400)],
    compute: (c, p) => ({ series: [line("uo", "UO", "#f44336", pts(c, ultimateOscillator(c, p)), { width: 2 })], levels: [{ value: 70 }, { value: 30 }], range: [0, 100] }) },
  { id: "cmo", label: "Chande Momentum Oscillator", group: "Oscillators", placement: "pane", paneHeight: 110, params: [P("length", "Length", 9, 1, 200)],
    compute: (c, p) => ({ series: [line("cmo", "CMO", "#2196f3", pts(c, cmo(c, p.length)), { width: 2 })], levels: [{ value: 50 }, { value: 0 }, { value: -50 }], range: [-100, 100] }) },
  { id: "dpo", label: "Detrended Price Oscillator", group: "Oscillators", placement: "pane", paneHeight: 100, params: [P("length", "Length", 21, 2, 500)],
    compute: (c, p) => ({ series: [line("dpo", "DPO", "#43a047", pts(c, dpo(c, p.length)), { width: 2 })], levels: [{ value: 0 }] }) },
  { id: "fisher", label: "Fisher Transform", group: "Oscillators", placement: "pane", paneHeight: 110, params: [P("length", "Length", 9, 1, 200)],
    compute: (c, p) => { const f = fisher(c, p.length);
      return { series: [line("fisher", "Fisher", "#2962ff", pts(c, f.fish), { width: 2 }), line("trigger", "Trigger", "#ff6d00", pts(c, f.trigger))], levels: [{ value: 1.5 }, { value: 0 }, { value: -1.5 }] }; } },
  { id: "kst", label: "Know Sure Thing", group: "Oscillators", placement: "pane", paneHeight: 110, params: [],
    compute: c => { const k = kst(c);
      return { series: [line("kst", "KST", "#009688", pts(c, k.line), { width: 2 }), line("signal", "Signal", "#f44336", pts(c, k.signal))], levels: [{ value: 0 }] }; } },
  { id: "coppock", label: "Coppock Curve", group: "Oscillators", placement: "pane", paneHeight: 100,
    params: [P("wmaLength", "WMA length", 10, 1, 200), P("longRoc", "Long ROC", 14, 1, 200), P("shortRoc", "Short ROC", 11, 1, 200)],
    compute: (c, p) => ({ series: [line("cc", "Coppock", "#2196f3", pts(c, coppock(c, p)), { width: 2 })], levels: [{ value: 0 }] }) },
  { id: "rvgi", label: "Relative Vigor Index", group: "Oscillators", placement: "pane", paneHeight: 100, params: [P("length", "Length", 10, 1, 200)],
    compute: (c, p) => { const r = rvgi(c, p.length);
      return { series: [line("rvgi", "RVGI", "#26a69a", pts(c, r.line), { width: 2 }), line("signal", "Signal", "#ef5350", pts(c, r.signal))], levels: [{ value: 0 }] }; } },
  { id: "stc", label: "Schaff Trend Cycle", group: "Oscillators", placement: "pane", paneHeight: 100,
    params: [P("length", "Cycle length", 10, 1, 200), P("fast", "Fast", 23, 1, 200), P("slow", "Slow", 50, 2, 400)],
    compute: (c, p) => ({ series: [line("stc", "STC", "#ab47bc", pts(c, schaff(c, p)), { width: 2 })], levels: [{ value: 75 }, { value: 25 }], range: [0, 100] }) },
  { id: "crsi", label: "Connors RSI", group: "Oscillators", placement: "pane", paneHeight: 110,
    params: [P("rsiLength", "RSI length", 3, 1, 100), P("streakLength", "Up/down length", 2, 1, 100), P("rankLength", "ROC rank length", 100, 2, 500)],
    compute: (c, p) => ({ series: [line("crsi", "CRSI", "#2962ff", pts(c, connorsRsi(c, p)), { width: 2 })], levels: [{ value: 90 }, { value: 10 }], range: [0, 100] }) },
  { id: "bop", label: "Balance of Power", group: "Oscillators", placement: "pane", paneHeight: 100, params: [P("smoothing", "Smoothing", 14, 1, 200)],
    compute: (c, p) => ({ series: [line("bop", "BOP", "#e91e63", pts(c, smaArr(c.map(k => k.high === k.low ? 0 : (k.close - k.open) / (k.high - k.low)), p.smoothing)), { width: 2 })], levels: [{ value: 0 }] }) },
  { id: "bbpower", label: "Bull Bear Power", group: "Oscillators", placement: "pane", paneHeight: 100, params: [P("length", "Length", 13, 1, 200)],
    compute: (c, p) => { const e = emaArr(closes(c), p.length);
      return { series: [{ key: "bbp", label: "BBPower", color: "#26a69a", type: "histogram", data: pts(c, c.map((k, i) => e[i] === null ? null : (k.high - e[i]) + (k.low - e[i]))) }], levels: [{ value: 0 }] }; } },
  { id: "bbpercent", label: "Bollinger %B", group: "Oscillators", placement: "pane", paneHeight: 100,
    params: [P("length", "Length", 20, 2, 500), P("multiplier", "StdDev", 2, 0.1, 10, 0.1)],
    compute: (c, p) => { const b = bollinger(c, p.length, p.multiplier);
      return { series: [line("pb", "%B", "#26a69a", pts(c, c.map((k, i) => b.upper[i] === null || b.upper[i] === b.lower[i] ? null : (k.close - b.lower[i]) / (b.upper[i] - b.lower[i]))), { width: 2 })],
        levels: [{ value: 1 }, { value: 0.5 }, { value: 0 }] }; } },
  // ---- Trend strength & volatility ----
  { id: "aroon", label: "Aroon", group: "Trend strength & volatility", placement: "pane", paneHeight: 110, params: [P("length", "Length", 14, 1, 500)],
    compute: (c, p) => { const a = aroon(c, p.length);
      return { series: [line("up", "Aroon Up", "#ff6d00", pts(c, a.up), { width: 2 }), line("down", "Aroon Down", "#2962ff", pts(c, a.down), { width: 2 })], range: [0, 100] }; } },
  { id: "vortex", label: "Vortex Indicator", group: "Trend strength & volatility", placement: "pane", paneHeight: 100, params: [P("length", "Length", 14, 2, 500)],
    compute: (c, p) => { const v = vortex(c, p.length);
      return { series: [line("plus", "VI+", "#2962ff", pts(c, v.plus), { width: 2 }), line("minus", "VI−", "#e91e63", pts(c, v.minus), { width: 2 })], levels: [{ value: 1 }] }; } },
  { id: "chop", label: "Choppiness Index", group: "Trend strength & volatility", placement: "pane", paneHeight: 100, params: [P("length", "Length", 14, 2, 500)],
    compute: (c, p) => ({ series: [line("chop", "CHOP", "#2962ff", pts(c, choppiness(c, p.length)), { width: 2 })], levels: [{ value: 61.8 }, { value: 38.2 }], range: [0, 100] }) },
  { id: "massindex", label: "Mass Index", group: "Trend strength & volatility", placement: "pane", paneHeight: 100, params: [P("length", "Length", 10, 2, 200)],
    compute: (c, p) => ({ series: [line("mi", "Mass Index", "#2196f3", pts(c, massIndex(c, p.length)), { width: 2 })], levels: [{ value: 27 }, { value: 26.5 }] }) },
  { id: "bbwidth", label: "Bollinger BandWidth", group: "Trend strength & volatility", placement: "pane", paneHeight: 100,
    params: [P("length", "Length", 20, 2, 500), P("multiplier", "StdDev", 2, 0.1, 10, 0.1)],
    compute: (c, p) => { const b = bollinger(c, p.length, p.multiplier);
      return { series: [line("bbw", "BBW", "#2962ff", pts(c, b.basis.map((m, i) => m === null || m === 0 ? null : (b.upper[i] - b.lower[i]) / m)), { width: 2 })] }; } },
  { id: "hv", label: "Historical Volatility", group: "Trend strength & volatility", placement: "pane", paneHeight: 100, params: [P("length", "Length", 10, 2, 500)],
    compute: (c, p) => ({ series: [line("hv", "HV %", "#2196f3", pts(c, historicalVolatility(c, p.length)), { width: 2 })] }) },
  { id: "stdev", label: "Standard Deviation", group: "Trend strength & volatility", placement: "pane", paneHeight: 100, params: [P("length", "Length", 20, 2, 500)],
    compute: (c, p) => ({ series: [line("sd", "StdDev", "#ff9800", pts(c, stdevArr(closes(c), p.length)), { width: 2 })] }) },
  { id: "ulcer", label: "Ulcer Index", group: "Trend strength & volatility", placement: "pane", paneHeight: 100, params: [P("length", "Length", 14, 2, 500)],
    compute: (c, p) => ({ series: [line("ui", "Ulcer", "#2962ff", pts(c, ulcerIndex(c, p.length)), { width: 2 })] }) },
  { id: "rvi", label: "Relative Volatility Index", group: "Trend strength & volatility", placement: "pane", paneHeight: 100,
    params: [P("length", "StdDev length", 10, 2, 200), P("smoothing", "Smoothing", 14, 1, 200)],
    compute: (c, p) => ({ series: [line("rvi", "RVI", "#7e57c2", pts(c, relativeVolatility(c, p)), { width: 2 })], levels: [{ value: 80 }, { value: 20 }], range: [0, 100] }) },
  // ---- Volume ----
  { id: "ad", label: "Accumulation/Distribution", group: "Volume", placement: "pane", paneHeight: 100, params: [],
    compute: c => ({ series: [line("ad", "A/D", "#999999", pts(c, accumulationDistribution(c)), { width: 2 })] }) },
  { id: "chaikinosc", label: "Chaikin Oscillator", group: "Volume", placement: "pane", paneHeight: 100,
    params: [P("fast", "Fast", 3, 1, 100), P("slow", "Slow", 10, 2, 200)],
    compute: (c, p) => { const ad = accumulationDistribution(c);
      return { series: [line("co", "Chaikin Osc", "#ec407a", pts(c, combine(emaArr(ad, p.fast), emaArr(ad, p.slow), (a, b) => a - b)), { width: 2 })], levels: [{ value: 0 }] }; } },
  { id: "pvt", label: "Price Volume Trend", group: "Volume", placement: "pane", paneHeight: 100, params: [],
    compute: c => ({ series: [line("pvt", "PVT", "#2962ff", pts(c, priceVolumeTrend(c)), { width: 2 })] }) },
  { id: "eom", label: "Ease of Movement", group: "Volume", placement: "pane", paneHeight: 100,
    params: [P("length", "Length", 14, 1, 200), P("divisor", "Divisor", 10000, 1, 1e9)],
    compute: (c, p) => ({ series: [line("eom", "EOM", "#43a047", pts(c, easeOfMovement(c, p)), { width: 2 })], levels: [{ value: 0 }] }) },
  { id: "efi", label: "Elder Force Index", group: "Volume", placement: "pane", paneHeight: 100, params: [P("length", "Length", 13, 1, 200)],
    compute: (c, p) => ({ series: [line("efi", "EFI", "#f44336", pts(c, forceIndex(c, p.length)), { width: 2 })], levels: [{ value: 0 }] }) },
  { id: "klinger", label: "Klinger Oscillator", group: "Volume", placement: "pane", paneHeight: 110,
    params: [P("fast", "Fast", 34, 1, 200), P("slow", "Slow", 55, 2, 400), P("signal", "Signal", 13, 1, 100)],
    compute: (c, p) => { const k = klinger(c, p);
      return { series: [line("kvo", "KVO", "#2962ff", pts(c, k.kvo), { width: 2 }), line("signal", "Signal", "#43a047", pts(c, k.signal))], levels: [{ value: 0 }] }; } },
  { id: "volosc", label: "Volume Oscillator", group: "Volume", placement: "pane", paneHeight: 100,
    params: [P("short", "Short", 5, 1, 200), P("long", "Long", 10, 2, 400)],
    compute: (c, p) => ({ series: [line("vo", "VO %", "#2196f3", pts(c, volumeOscillator(c, p)), { width: 2 })], levels: [{ value: 0 }] }) },
  { id: "netvolume", label: "Net Volume", group: "Volume", placement: "pane", paneHeight: 100, params: [],
    compute: c => ({ series: [{ key: "nv", label: "Net Volume", color: "#26a69a", type: "histogram", data: pts(c, netVolume(c)) }], levels: [{ value: 0 }] }) },
];
export const EXTRA_INDICATOR_IDS = EXTRA_INDICATORS.map(def => def.id);
const BY_ID = new Map(EXTRA_INDICATORS.map(def => [def.id, def]));
export const extraIndicator = id => BY_ID.get(id) ?? null;

/** Defaults merged with valid user values; invalid values fall back to defaults. */
export function extraParams(id, saved = {}) {
  const def = BY_ID.get(id);
  if (!def) return {};
  return Object.fromEntries(def.params.map(param => {
    const value = Number(saved?.[param.key]);
    const valid = Number.isFinite(value) && value >= param.min && value <= param.max
      && (param.step < 1 || Number.isInteger(value));
    return [param.key, valid ? value : param.default];
  }));
}

export function computeExtraIndicator(id, candles, saved) {
  const def = BY_ID.get(id);
  if (!def || !Array.isArray(candles) || candles.length === 0) return null;
  return def.compute(candles, extraParams(id, saved));
}
