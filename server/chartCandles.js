import { requestJson, requestGates } from "./exchangeRequests.js";
import { isCryptoAsset } from "./cryptoAssets.js";

const intervals = {
  "5m": ["5m", "5", 300], "15m": ["15m", "15", 900],
  "30m": ["30m", "30", 1800], "1h": ["1h", "60", 3600],
  "4h": ["4h", "240", 14400], "24h": ["1d", "D", 86400],
};
export function validateCandleQuery(query) {
  const exchange = query.exchange ?? "binance";
  const symbol = query.symbol ?? "BTCUSDT";
  const timeframe = query.timeframe ?? "1h";
  if (!["binance", "bybit"].includes(exchange) || typeof symbol !== "string" ||
    !/^[A-Z0-9]{2,30}USDT$/.test(symbol) || typeof timeframe !== "string" || !intervals[timeframe]) {
    throw Object.assign(new Error("Choose Binance or Bybit, an uppercase USDT perpetual symbol, and a supported timeframe."), { status: 400 });
  }
  return { exchange, symbol, timeframe };
}
export function parseCandles(exchange, body, timeframe, now = Date.now()) {
  const rows = exchange === "binance" ? body : body.result?.list;
  if (!Array.isArray(rows) || !rows.length) throw new Error("Exchange returned no candles for this contract.");
  const seconds = intervals[timeframe][2];
  const candles = rows.map(row => {
    if (!Array.isArray(row) || row.length < 6) throw new Error("Malformed exchange candle.");
    const values = row.slice(0, 6).map(value => value === "" || value === null ? NaN : Number(value));
    const [ms, open, high, low, close, volume] = values;
    if (!values.every(Number.isFinite) || ms <= 0 || ms % 1000 !== 0 ||
      Math.min(open, high, low, close) <= 0 || volume < 0 ||
      high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      throw new Error("Invalid exchange candle prices or volume.");
    }
    return { time: ms / 1000, open, high, low, close, volume, closed: ms + seconds * 1000 <= now };
  }).sort((a, b) => a.time - b.time);
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time - candles[i - 1].time !== seconds) {
      throw new Error("Exchange candle history has a gap or duplicate timestamp; indicator calculation paused.");
    }
  }
  return candles;
}

/** Shared, bounded per-series cache. Refresh never bypasses the exchange gates. */
export function createCandleService({ request = requestJson, gates = requestGates, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map(), metadata = new Map();
  let binanceInfo = null, binanceInfoAt = 0, binanceInfoPending = null;
  const trim = map => { while (map.size > 100) map.delete(map.keys().next().value); };
  async function validateContract(exchange, symbol) {
    const key = `${exchange}:${symbol}`;
    let instrument = metadata.get(key);
    if (instrument && instrument.expires > now()) return instrument.value;
    if (exchange === "binance") {
      if (!binanceInfo || now() - binanceInfoAt >= 3_600_000) {
        if (!binanceInfoPending) {
          binanceInfoPending = request("https://fapi.binance.com/fapi/v1/exchangeInfo")
            .then(body => {
              if (!Array.isArray(body.symbols)) throw new Error("Contract metadata unavailable.");
              binanceInfo = body.symbols; binanceInfoAt = now();
            }).finally(() => { binanceInfoPending = null; });
        }
        await binanceInfoPending;
      }
      instrument = binanceInfo.find(item => item.symbol === symbol && item.status === "TRADING" &&
        item.contractType === "PERPETUAL" && item.quoteAsset === "USDT");
    } else {
      const body = await request(`https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${symbol}`);
      instrument = body.result?.list?.find(item => item.symbol === symbol && item.status === "Trading" &&
        item.contractType === "LinearPerpetual" && item.quoteCoin === "USDT");
    }
    const base = instrument?.baseAsset ?? instrument?.baseCoin;
    if (!instrument || !isCryptoAsset(base, symbol)) {
      throw Object.assign(new Error("This symbol is not a supported, verified crypto USDT perpetual contract."), { status: 400 });
    }
    metadata.set(key, { value: instrument, expires: now() + 3_600_000 }); trim(metadata);
    return instrument;
  }
  async function get(query) {
    const { exchange, symbol, timeframe } = validateCandleQuery(query);
    const key = `${exchange}:${symbol}:${timeframe}`;
    const saved = cache.get(key);
    if (saved && now() < saved.nextAttempt) {
      if (saved.data) return saved.error
        ? { ...saved.data, stale: true, error: saved.error.message, retryAt: saved.nextAttempt }
        : saved.data;
      throw saved.error;
    }
    if (pending.has(key)) return pending.get(key);
    // Bound in-flight user-selected markets as well as retained cache entries.
    if (pending.size >= 4) throw Object.assign(new Error("Chart requests are busy. Please try again shortly."), { status: 503 });
    const task = (async () => {
      try {
        await validateContract(exchange, symbol);
        const [binanceInterval, bybitInterval] = intervals[timeframe];
        const url = exchange === "binance"
          ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${binanceInterval}&limit=1000`
          : `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${bybitInterval}&limit=1000`;
        const body = await request(url);
        const candles = parseCandles(exchange, body, timeframe, now());
        const data = { exchange, symbol, timeframe, candles, fetchedAt: new Date(now()).toISOString(), stale: false };
        cache.set(key, { data, nextAttempt: now() + 30_000 }); trim(cache);
        return data;
      } catch (cause) {
        const retryAt = Math.max(now() + 60_000, cause.retryAt ?? 0, gates[exchange]?.blockedUntil ?? 0);
        // Do not expose a raw upstream body or ban message (may contain an IP).
        const error = Object.assign(new Error(cause.status === 400 ? cause.message
          : "Exchange candle data is currently unavailable. Requests are paused before retrying."), {
          status: cause.status === 400 ? 400 : 503, retryAt,
        });
        cache.set(key, { data: saved?.data, error, nextAttempt: retryAt }); trim(cache);
        if (saved?.data) return { ...saved.data, stale: true, error: error.message, retryAt };
        throw error;
      }
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }
  return { get };
}

export const candleService = createCandleService();
