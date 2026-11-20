// Shared chart timeframes (server and browser). All buckets are UTC.
// Fixed-length: 1m … 1D. Calendar: 1W (Monday start), 1M (calendar month),
// 3M (calendar quarter: Jan/Apr/Jul/Oct). Existing id "24h" means 1D.

export const CHART_TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "24h", "1w", "1mo", "3mo"];
export const TIMEFRAME_LABELS = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h",
  "24h": "1D", "1w": "1W", "1mo": "1M", "3mo": "3M",
};
const FIXED = { "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "24h": 86400, "1w": 604800 };
const MONDAY_OFFSET = 4 * 86400; // 1970-01-01 was a Thursday; 1970-01-05 a Monday.

export const isTimeframe = value => CHART_TIMEFRAMES.includes(value);
export const isCalendarTimeframe = tf => tf === "1mo" || tf === "3mo";

/** Nominal length in seconds (months/quarters use their maximum for freshness checks). */
export function timeframeSeconds(tf) {
  if (FIXED[tf]) return FIXED[tf];
  if (tf === "1mo") return 31 * 86400;
  if (tf === "3mo") return 92 * 86400;
  throw new Error(`Unknown timeframe ${tf}`);
}

/** Start (unix seconds) of the bucket containing `seconds`. */
export function bucketStart(tf, seconds) {
  if (tf === "1w") return Math.floor((seconds - MONDAY_OFFSET) / FIXED["1w"]) * FIXED["1w"] + MONDAY_OFFSET;
  if (FIXED[tf]) return Math.floor(seconds / FIXED[tf]) * FIXED[tf];
  const date = new Date(seconds * 1000);
  const month = tf === "3mo" ? Math.floor(date.getUTCMonth() / 3) * 3 : date.getUTCMonth();
  return Date.UTC(date.getUTCFullYear(), month, 1) / 1000;
}

/** Start of the bucket after the one starting at `start`. */
export function nextBucket(tf, start) {
  if (FIXED[tf]) return start + FIXED[tf];
  const date = new Date(start * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + (tf === "3mo" ? 3 : 1), 1) / 1000;
}

/**
 * Combine smaller candles into `tf` buckets: first open, highest high, lowest
 * low, last close, summed volume. A bucket is closed only when all its parts
 * are closed and its period has ended. A first bucket that is missing its
 * beginning (history started mid-bucket) is dropped, never shown as complete.
 */
export function aggregateCandles(candles, tf, nowMs = Date.now()) {
  const out = [];
  let current = null;
  for (const bar of candles) {
    const start = bucketStart(tf, bar.time);
    if (!current || current.time !== start) {
      if (current) out.push(current);
      current = { time: start, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        volume: bar.volume, closed: bar.closed !== false, firstPart: bar.time };
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
      current.closed = current.closed && bar.closed !== false;
    }
  }
  if (current) out.push(current);
  const result = out.map(({ firstPart, ...bar }) => ({ ...bar, closed: bar.closed && nextBucket(tf, bar.time) * 1000 <= nowMs, firstPart }));
  if (result.length && result[0].firstPart !== result[0].time) result.shift();
  return result.map(({ firstPart, ...bar }) => bar);
}

/** True when `candles` are consecutive `tf` buckets (no gaps or duplicates). */
export function isContiguous(candles, tf) {
  for (let i = 1; i < candles.length; i++) if (nextBucket(tf, candles[i - 1].time) !== candles[i].time) return false;
  return true;
}
