// Sub-minute candles (1s/5s/15s/30s) built from the selected contract's own
// live executed trades. Perpetual exchange APIs do not publish seconds
// candles (Binance USD-M has no 1s klines), so these come from the public
// trade streams the CVD collector already receives: exact OHLC and volume
// from real executions. History starts when recording starts (kept 2 hours);
// a second with no trades has no candle, as on exchanges.
import { aggregateCandles, isSecondTimeframe } from "./timeframes.js";

export const SECOND_RETENTION_SECONDS = 2 * 3600;
const IDLE_MS = 10 * 60_000;

export function createSecondCandleRecorder({ now = Date.now, retention = SECOND_RETENTION_SECONDS } = {}) {
  /** key `${exchange}:${symbol}` -> { since, lastRequested, divisor, bars: Map<sec, bar> } */
  const series = new Map();

  /** Start (or keep) recording a contract. `divisor` converts canonical prices back to native. */
  function watch(exchange, symbol, divisor = 1) {
    const key = `${exchange}:${symbol}`;
    let entry = series.get(key);
    if (!entry) { entry = { since: now(), lastRequested: now(), divisor, bars: new Map() }; series.set(key, entry); }
    entry.lastRequested = now();
    entry.divisor = divisor;
    return entry;
  }

  /** Feed one executed trade (canonical price/quantity as produced by the trade codec). */
  function ingest(trade) {
    const entry = series.get(`${trade.exchange}:${trade.symbol}`);
    if (!entry || !(trade.price > 0) || !(trade.quantity > 0) || !Number.isFinite(trade.time)) return;
    if (trade.time < entry.since) return; // never before recording started
    const second = Math.floor(trade.time / 1000);
    const price = trade.price * entry.divisor, volume = trade.quantity / entry.divisor;
    const bar = entry.bars.get(second);
    if (!bar) entry.bars.set(second, { time: second, open: price, high: price, low: price, close: price, volume, lastTrade: trade.time });
    else {
      bar.high = Math.max(bar.high, price); bar.low = Math.min(bar.low, price); bar.volume += volume;
      // Trades can arrive slightly out of order; close follows the latest execution time.
      if (trade.time >= bar.lastTrade) { bar.close = price; bar.lastTrade = trade.time; }
    }
  }

  function prune() {
    const cutoff = Math.floor(now() / 1000) - retention;
    for (const [key, entry] of series) {
      if (now() - entry.lastRequested > IDLE_MS) { series.delete(key); continue; }
      for (const second of entry.bars.keys()) if (second < cutoff) entry.bars.delete(second);
    }
  }

  function candles(exchange, symbol, timeframe) {
    if (!isSecondTimeframe(timeframe)) throw new Error("Not a seconds timeframe.");
    prune();
    const entry = series.get(`${exchange}:${symbol}`);
    if (!entry) return { candles: [], since: null };
    const nowSec = Math.floor(now() / 1000);
    const bars = [...entry.bars.values()].sort((a, b) => a.time - b.time)
      .map(({ lastTrade, ...bar }) => ({ ...bar, closed: bar.time < nowSec }));
    const out = timeframe === "1s" ? bars : aggregateCandles(bars, timeframe, now());
    return { candles: out, since: new Date(entry.since).toISOString() };
  }

  return { watch, ingest, candles, prune, size: () => series.size };
}

export const secondCandleRecorder = createSecondCandleRecorder();
