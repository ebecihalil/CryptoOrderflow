import { requestJson, requestGates } from "./exchangeRequests.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { CHART_VENUES, createMarketContractService, marketContractService } from "./marketContracts.js";
import { fetchVenueCandles, VENUE_NATIVE_FRAMES } from "./venueCandles.js";
import { canonicalAsset } from "./assetIdentity.js";
import { aggregateCandles, isContiguous, isTimeframe, nextBucket } from "./timeframes.js";

// [Binance interval, Bybit interval] for natively supported timeframes.
// Binance/Bybit weeks start Monday and months are calendar months (UTC).
const intervals = {
  "1m": ["1m", "1"], "3m": ["3m", "3"], "5m": ["5m", "5"], "15m": ["15m", "15"],
  "30m": ["30m", "30"], "1h": ["1h", "60"], "4h": ["4h", "240"], "24h": ["1d", "D"],
  "1w": ["1w", "W"], "1mo": ["1M", "M"],
};
/**
 * Timeframes a venue does not provide natively are built from a smaller
 * native timeframe (see timeframes.js). Returns the base timeframe or null.
 */
export function derivedFrom(exchange, timeframe) {
  const native = VENUE_NATIVE_FRAMES[exchange];
  if (native) {
    // New venues: build anything they don't publish from their own smaller candles.
    if (native.includes(timeframe)) return null;
    if (timeframe === "3m") return "1m";
    if (timeframe === "1w") return "24h";
    if (timeframe === "1mo") return "24h";
    if (timeframe === "3mo") return native.includes("1mo") ? "1mo" : "24h";
    return null;
  }
  if (timeframe === "3mo") return exchange === "okx" ? null : "1mo";
  if (["gate", "mexc"].includes(exchange) && timeframe === "3m") return "1m";
  // Weekly/monthly alignment is only trusted where documented as Monday/calendar UTC.
  if (["gate", "mexc", "bingx"].includes(exchange) && (timeframe === "1w" || timeframe === "1mo")) return "24h";
  return null;
}
export function validateCandleQuery(query) {
  const exchange = query.exchange ?? "binance";
  const symbol = query.symbol ?? "BTCUSDT";
  const timeframe = query.timeframe ?? "1h";
  if (typeof exchange !== "string" || !Object.hasOwn(CHART_VENUES, exchange) || typeof symbol !== "string" ||
    !/^[A-Z0-9_-]{2,45}$/.test(symbol) || (["binance", "bybit"].includes(exchange) && !/^[A-Z0-9]{2,30}USDT$/.test(symbol)) ||
    typeof timeframe !== "string" || !isTimeframe(timeframe)) {
    throw Object.assign(new Error("Choose a supported exchange, a verified USDT perpetual symbol, and a supported timeframe."), { status: 400 });
  }
  return { exchange, symbol, timeframe };
}
export function parseCandles(exchange, body, timeframe, now = Date.now()) {
  const rows = exchange === "binance" ? body : body.result?.list;
  if (!Array.isArray(rows) || !rows.length) throw new Error("Exchange returned no candles for this contract.");
  const candles = rows.map(row => {
    if (!Array.isArray(row) || row.length < 6) throw new Error("Malformed exchange candle.");
    const values = row.slice(0, 6).map(value => value === "" || value === null ? NaN : Number(value));
    const [ms, open, high, low, close, volume] = values;
    if (!values.every(Number.isFinite) || ms <= 0 || ms % 1000 !== 0 ||
      Math.min(open, high, low, close) <= 0 || volume < 0 ||
      high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      throw new Error("Invalid exchange candle prices or volume.");
    }
    return { time: ms / 1000, open, high, low, close, volume };
  }).sort((a, b) => a.time - b.time);
  if (!isContiguous(candles, timeframe)) {
    throw new Error("Exchange candle history has a gap or duplicate timestamp; indicator calculation paused.");
  }
  // Closed when the next bucket has started (calendar-aware for 1W/1M/3M).
  return candles.map((bar, i) => ({ ...bar, closed: i < candles.length - 1 || nextBucket(timeframe, bar.time) * 1000 <= now }));
}

/** Shared, bounded per-series cache. Refresh never bypasses the exchange gates. */
export function createCandleService({ request = requestJson, gates = requestGates, now = Date.now, contracts } = {}) {
  const cache = new Map(), pending = new Map(), metadata = new Map();
  let binanceInfo = null, binanceInfoAt = 0, binanceInfoPending = null;
  const catalogue = contracts ?? (request === requestJson ? marketContractService : createMarketContractService({ request, gates, now }));
  const trim = map => { while (map.size > 100) map.delete(map.keys().next().value); };
  async function validateContract(exchange, symbol) {
    if (!["binance", "bybit"].includes(exchange)) return catalogue.lookup(exchange, symbol);
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
  async function get(query, { internal = false } = {}) {
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
    if (!internal && pending.size >= 4) throw Object.assign(new Error("Chart requests are busy. Please try again shortly."), { status: 503 });
    const task = (async () => {
      try {
        const instrument = await validateContract(exchange, symbol);
        const baseTimeframe = derivedFrom(exchange, timeframe);
        if (baseTimeframe) {
          // Built from the venue's smaller native candles (same units and gates).
          const baseData = await get({ exchange, symbol, timeframe: baseTimeframe }, { internal: true });
          if (baseData.stale) throw Object.assign(new Error(baseData.error ?? "Base candles unavailable."), { retryAt: baseData.retryAt });
          const candles = aggregateCandles(baseData.candles, timeframe, now());
          if (!candles.length) throw new Error("Not enough history to build this timeframe.");
          const data = { ...baseData, timeframe, candles, fetchedAt: new Date(now()).toISOString(), stale: false, derivedFrom: baseTimeframe };
          cache.set(key, { data, nextAttempt: now() + 30_000 }); trim(cache);
          return data;
        }
        const [binanceInterval, bybitInterval] = intervals[timeframe];
        const url = exchange === "binance"
          ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${binanceInterval}&limit=1000`
          : `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${bybitInterval}&limit=1000`;
        const legacy = ["binance", "bybit"].includes(exchange);
        const body = legacy ? await request(url) : await fetchVenueCandles(request, exchange, instrument, timeframe, now());
        const candles = parseCandles(legacy ? exchange : "binance", body, timeframe, now());
        const base = instrument.exchangeAsset ?? instrument.baseAsset ?? instrument.baseCoin;
        const identity = canonicalAsset(base);
        const data = { exchange, symbol: instrument.symbol ?? symbol, asset: identity.asset, priceDivisor: identity.priceDivisor,
          timeframe, candles, fetchedAt: new Date(now()).toISOString(), stale: false };
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
