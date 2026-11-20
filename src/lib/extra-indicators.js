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
