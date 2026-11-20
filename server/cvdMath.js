import { CHART_TIMEFRAMES, bucketStart, nextBucket, timeframeSeconds } from "./timeframes.js";
// All chart timeframes; CVD is built from per-minute recordings, so 1m/3m work
// and calendar frames (1W/1M/3M) cover only the recorded history (partial).
export const CVD_FRAMES = Object.fromEntries(CHART_TIMEFRAMES.map(tf => [tf, timeframeSeconds(tf)]));
export const CVD_ANCHORS = ["1d", "1w", "1m", "3m", "6m", "1y"];

export function cvdAnchorStart(seconds, anchor) {
  if (!Number.isFinite(seconds) || !CVD_ANCHORS.includes(anchor)) throw new Error("Invalid CVD anchor.");
  const date = new Date(seconds * 1000);
  date.setUTCHours(0, 0, 0, 0);
  if (anchor === "1w") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  else if (anchor !== "1d") {
    date.setUTCDate(1);
    const months = anchor === "1m" ? 1 : anchor === "3m" ? 3 : anchor === "6m" ? 6 : 12;
    date.setUTCMonth(Math.floor(date.getUTCMonth() / months) * months);
  }
  return date.getTime() / 1000;
}

// Per-minute relative OHLC is constructed from time-ordered signed executions,
// not estimated from OHLC price direction or summed venue high/low values.
export function newCvdMinute(time, gap = false) {
  return { time, delta: 0, high: 0, low: 0, buyValue: 0, sellValue: 0, trades: 0, sources: [], gap };
}
export function addCvdTrade(minute, trade) {
  if (!["buy", "sell"].includes(trade.side) || !(trade.value > 0 && Number.isFinite(trade.value))) throw new Error("Invalid signed trade.");
  const signed = trade.side === "buy" ? trade.value : -trade.value;
  minute.delta += signed;
  minute.high = Math.max(minute.high, minute.delta);
  minute.low = Math.min(minute.low, minute.delta);
  minute[trade.side === "buy" ? "buyValue" : "sellValue"] += trade.value;
  minute.trades++;
  if (!minute.sources.includes(trade.exchange)) minute.sources.push(trade.exchange);
  // Per-exchange [buy USD, sell USD], so indicators can require complete data per exchange.
  minute.byExchange ??= {};
  const row = minute.byExchange[trade.exchange] ??= [0, 0];
  row[trade.side === "buy" ? 0 : 1] += trade.value;
  return minute;
}
export function buildCvdCandles(minutes, timeframe, anchor, nowSeconds) {
  const step = CVD_FRAMES[timeframe];
  if (!step || !CVD_ANCHORS.includes(anchor)) throw new Error("Invalid CVD resolution.");
  const rows = [...minutes].sort((a, b) => a.time - b.time);
  let baseline = 0, previousAnchor, current;
  const candles = [];
  for (const minute of rows) {
    if (!minute.trades || minute.time > nowSeconds) continue;
    const reset = cvdAnchorStart(minute.time, anchor);
    const time = bucketStart(timeframe, minute.time);
    // Coverage gaps do not erase observed cumulative flow. The next observed
    // candle opens at the previous close; only calendar anchor changes reset it.
    if (reset !== previousAnchor) {
      baseline = 0;
      if (current?.time === time) candles.pop();
      current = undefined;
    }
    if (!current || current.time !== time) {
      current = { time, open: baseline, high: baseline, low: baseline, close: baseline,
        buyValue: 0, sellValue: 0, trades: 0, sourceCount: 0, provisional: nextBucket(timeframe, time) > nowSeconds,
        partial: true, segmentStart: reset !== previousAnchor || candles.length === 0, _sources: new Set() };
      candles.push(current);
    }
    current.high = Math.max(current.high, baseline + minute.high);
    current.low = Math.min(current.low, baseline + minute.low);
    baseline += minute.delta;
    current.close = baseline;
    current.buyValue += minute.buyValue; current.sellValue += minute.sellValue; current.trades += minute.trades;
    minute.sources.forEach(s => current._sources.add(s));
    current.sourceCount = current._sources.size;
    previousAnchor = reset;
  }
  return candles.map(({ _sources, ...candle }) => candle);
}

export function validateCvdQuery(query) {
  const { asset, market = "perpetual", timeframe = "1h", anchor = "1w" } = query;
  if (typeof asset !== "string" || !/^[A-Z0-9]{1,30}$/.test(asset) ||
    !["spot", "perpetual"].includes(market) || typeof timeframe !== "string" ||
    !Object.hasOwn(CVD_FRAMES, timeframe) || !CVD_ANCHORS.includes(anchor)) {
    throw Object.assign(new Error("CVD requires a canonical crypto asset, spot/perpetual market, supported timeframe and anchor."), { status: 400 });
  }
  return { asset, market, timeframe, anchor };
}
