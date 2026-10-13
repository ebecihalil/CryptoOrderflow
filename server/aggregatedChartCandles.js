import { candleService, parseCandles, validateCandleQuery } from "./chartCandles.js";
import { requestJson, requestGates } from "./exchangeRequests.js";
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { aggregateCandleVolumes, CANDLE_SECONDS, VOLUME_EXCHANGES, parseGateVolumeRows, parseOkxVolumeRows } from "./candleVolumeMath.js";

const okxBars = { "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "24h": "1Dutc" };
const trim = map => { while (map.size > 100) map.delete(map.keys().next().value); };
const safeError = error => Object.assign(new Error("Volume source is unavailable; requests are paused before retrying."),
  { retryAt: error.retryAt, status: 503 });

/** All provider calls go through the project's shared IP-wide request gates. */
export function createAggregatedCandleService({
  single = candleService, request = requestJson, gates = requestGates, now = Date.now,
} = {}) {
  const catalogs = new Map(), catalogPending = new Map(), external = new Map(), externalPending = new Map();
  const aggregates = new Map(), aggregatePending = new Map();
  const olderOkx = new Map();
  const retryTime = (exchange, error) => Math.max(now() + 60_000, error.retryAt ?? 0, gates[exchange]?.blockedUntil ?? 0);

  async function catalog(exchange) {
    const saved = catalogs.get(exchange);
    if (saved && saved.expires > now()) {
      if (saved.error) throw saved.error;
      return saved.records;
    }
    if (catalogPending.has(exchange)) return catalogPending.get(exchange);
    const task = (async () => {
      try {
        let rows;
        if (exchange === "binance") {
          rows = (await request("https://fapi.binance.com/fapi/v1/exchangeInfo")).symbols;
          if (!Array.isArray(rows)) throw new Error("Missing Binance instruments.");
          rows = rows.filter(row => row.status === "TRADING" && row.contractType === "PERPETUAL" && row.quoteAsset === "USDT")
            .map(row => ({ symbol: row.symbol, base: row.baseAsset }));
        } else if (exchange === "bybit") {
          rows = []; let cursor = "";
          for (let page = 0; page < 10; page++) {
            const body = await request(`https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
            if (!Array.isArray(body.result?.list)) throw new Error("Missing Bybit instruments.");
            rows.push(...body.result.list);
            const next = body.result.nextPageCursor ?? "";
            if (!next) break;
            if (next === cursor || page === 9) throw new Error("Incomplete Bybit metadata pagination.");
            cursor = next;
          }
          rows = rows.filter(row => row.status === "Trading" && row.contractType === "LinearPerpetual" && row.quoteCoin === "USDT")
            .map(row => ({ symbol: row.symbol, base: row.baseCoin }));
        } else if (exchange === "okx") {
          rows = (await request("https://www.okx.com/api/v5/public/instruments?instType=SWAP")).data;
          if (!Array.isArray(rows)) throw new Error("Missing OKX instruments.");
          rows = rows.filter(row => row.state === "live" && row.settleCcy === "USDT" && row.ctType === "linear")
            .map(row => ({ symbol: row.instId, base: row.ctValCcy }));
        } else {
          rows = await request("https://api.gateio.ws/api/v4/futures/usdt/contracts");
          if (!Array.isArray(rows)) throw new Error("Missing Gate.io instruments.");
          rows = rows.filter(row => !row.in_delisting && row.name?.endsWith("_USDT") && Number(row.quanto_multiplier) > 0)
            .map(row => ({ symbol: row.name, base: row.name.slice(0, -5), contractSize: Number(row.quanto_multiplier) }));
        }
        const records = rows.filter(row => typeof row.base === "string" && isCryptoAsset(row.base))
          .map(row => ({ ...row, ...canonicalAsset(row.base) }));
        catalogs.set(exchange, { records, expires: now() + 3_600_000 });
        return records;
      } catch (cause) {
        const error = safeError(cause); error.retryAt = retryTime(exchange, cause);
        catalogs.set(exchange, { error, expires: error.retryAt }); throw error;
      }
    })().finally(() => catalogPending.delete(exchange));
    catalogPending.set(exchange, task);
    return task;
  }

  async function externalCandles(exchange, instrument, timeframe) {
    const key = `${exchange}:${instrument.symbol}:${timeframe}`, saved = external.get(key);
    if (saved && saved.expires > now()) {
      if (saved.error) throw saved.error;
      return saved.data;
    }
    if (externalPending.has(key)) return externalPending.get(key);
    const task = (async () => {
      try {
        let candles;
        if (exchange === "gate") {
          const body = await request(`https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${encodeURIComponent(instrument.symbol)}&interval=${timeframe === "24h" ? "1d" : timeframe}&limit=1000&timezone=utc0`);
          candles = parseCandles("binance", parseGateVolumeRows(body, instrument.contractSize), timeframe, now());
        } else {
          const base = `https://www.okx.com/api/v5/market/`;
          const params = `instId=${encodeURIComponent(instrument.symbol)}&bar=${okxBars[timeframe]}&limit=300`;
          const recent = (await request(`${base}candles?${params}`)).data;
          const recentRows = parseOkxVolumeRows(recent);
          let merged = new Map((olderOkx.get(key) ?? []).map(row => [Number(row[0]), row]));
          recent.forEach(row => merged.set(Number(row[0]), row));
          // A market revisited after >300 bars must backfill the gap, not retain
          // disconnected old pages merely because their combined count is large.
          const contiguous = new Map();
          for (let ts = Math.max(...merged.keys()); merged.has(ts) && contiguous.size < 1000;
            ts -= CANDLE_SECONDS[timeframe] * 1000) contiguous.set(ts, merged.get(ts));
          merged = contiguous;
          // Backfill once, then reuse older bars and fetch only the newest page.
          for (let page = 0; merged.size < 1000 && page < 4; page++) {
            const earliest = Math.min(...merged.keys());
            const batch = (await request(`${base}history-candles?${params}&after=${earliest}`)).data;
            if (!Array.isArray(batch)) throw new Error("Invalid OKX history.");
            if (!batch.length) break; // Newly listed contract: truthful shorter coverage.
            parseOkxVolumeRows(batch);
            let added = 0;
            for (const row of batch) {
              const ts = Number(row[0]);
              if (ts < earliest && !merged.has(ts)) { merged.set(ts, row); added++; }
            }
            if (!added) throw new Error("OKX history pagination made no progress.");
          }
          const rows = [...merged.values()].sort((a, b) => Number(a[0]) - Number(b[0])).slice(-1000);
          olderOkx.set(key, rows); trim(olderOkx);
          const normalized = parseOkxVolumeRows(rows);
          candles = parseCandles("binance", normalized.map(item => item.row), timeframe, now())
            .map((bar, index) => ({ ...bar, closed: bar.closed && normalized[index].confirmed }));
          // Validate recent data independently (also guards malformed empty pages).
          if (!recentRows.length) throw new Error("Missing recent OKX candles.");
        }
        const data = { exchange, candles, fetchedAt: new Date(now()).toISOString(), stale: false };
        external.set(key, { data, expires: now() + 30_000 }); trim(external);
        return data;
      } catch (cause) {
        const error = safeError(cause); error.retryAt = retryTime(exchange, cause);
        external.set(key, { error, expires: error.retryAt }); trim(external);
        throw error;
      }
    })().finally(() => externalPending.delete(key));
    externalPending.set(key, task);
    return task;
  }

  async function get(query) {
    validateCandleQuery(query);
    const mode = query.volumeMode ?? "single";
    if (!["single", "aggregated"].includes(mode)) throw Object.assign(new Error("volumeMode must be single or aggregated."), { status: 400 });
    if (mode === "single") return single.get(query);
    const key = `${query.exchange ?? "binance"}:${query.symbol ?? "BTCUSDT"}:${query.timeframe ?? "1h"}`;
    const cached = aggregates.get(key);
    if (cached && cached.expires > now()) {
      if (cached.error) throw cached.error;
      return cached.data;
    }
    if (aggregatePending.has(key)) return aggregatePending.get(key);
    if (aggregatePending.size >= 2) throw Object.assign(new Error("Volume aggregation is busy. Please try again shortly."), { status: 503 });
    const task = (async () => {
      try {
        const price = await single.get(query);
        const identity = canonicalAsset(price.symbol.slice(0, -4));
        const results = await Promise.all(VOLUME_EXCHANGES.map(async exchange => {
          let instrument = null;
          try {
            if (exchange === price.exchange) {
              instrument = { symbol: price.symbol, priceDivisor: identity.priceDivisor };
            } else {
              const matching = (await catalog(exchange)).filter(record => record.asset === identity.asset);
              // Use one contract per venue, preferring native underlying units.
              instrument = matching.sort((a, b) => a.priceDivisor - b.priceDivisor || a.symbol.localeCompare(b.symbol))[0];
              if (!instrument) throw new Error("Contract not listed on this venue.");
            }
            const snapshot = exchange === price.exchange ? price
              : ["binance", "bybit"].includes(exchange)
                ? await single.get({ exchange, symbol: instrument.symbol, timeframe: price.timeframe })
                : await externalCandles(exchange, instrument, price.timeframe);
            return { ...snapshot, exchange, divisor: instrument.priceDivisor, symbol: instrument.symbol };
          } catch {
            return { exchange, symbol: instrument?.symbol ?? null, unavailable: true };
          }
        }));
        const aligned = aggregateCandleVolumes(price, results, price.timeframe);
        const volumeSources = results.map(source => {
          const included = aligned.exchanges.includes(source.exchange);
          return { exchange: source.exchange, symbol: source.symbol, status: included ? "ok" : "unavailable",
            matchedBars: included ? aligned.candles.length : 0, fetchedAt: source.fetchedAt };
        });
        const data = { ...price, candles: aligned.candles, volumeMode: "aggregated", volumeAsset: identity.asset,
          volumeSources, matchedCandleCount: aligned.candles.length, partialVolume: aligned.exchanges.length < 4 };
        aggregates.set(key, { data, expires: now() + 30_000 }); trim(aggregates);
        return data;
      } catch (cause) {
        const error = Object.assign(new Error(cause.status === 400 ? cause.message : "Aligned aggregate volume is currently unavailable. Please retry later."),
          { status: cause.status === 400 ? 400 : 503, retryAt: cause.retryAt ?? now() + 60_000 });
        // Never reuse a former four-venue series as if it were a fresh partial one.
        if (cached?.data) {
          const data = { ...cached.data, stale: true, error: error.message, retryAt: error.retryAt };
          aggregates.set(key, { data, expires: error.retryAt }); return data;
        }
        aggregates.set(key, { error, expires: error.retryAt }); trim(aggregates); throw error;
      }
    })().finally(() => aggregatePending.delete(key));
    aggregatePending.set(key, task);
    return task;
  }
  return { get };
}
export const aggregatedCandleService = createAggregatedCandleService();
