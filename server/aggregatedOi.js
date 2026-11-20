// Aggregated Open Interest for Super Charts: classic OI candles (open, high,
// low, close) of the total open interest of every USDT- and USDC-margined
// perpetual of the coin, on every exchange the site collects. Nothing else.
//
// History: exchanges that publish OI history (Binance, Bybit, OKX, Gate) are
// read at the native interval closest to the chart timeframe, merged with the
// OI samples this server records itself (every exchange, ~30 s). Candles use
// the chart's own buckets (weeks start Monday, months are calendar months), so
// every chart candle, including the newest, has its OI candle.
//
// Consistency: each candle's change is measured only on contracts present in
// that candle and before it (a venue joining or leaving never creates a fake
// jump); candles are chained (each opens at the previous close, empty buckets
// are flat), and the whole series is scaled so the latest candle equals the
// real current total of ALL exchanges. Values are coins; the chart shows USD
// (coins × price).
import { canonicalAsset } from "./lsarMarketData.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { requestJson } from "./exchangeRequests.js";
import { getOiChartInputs } from "./openInterestMarketData.js";
import { number } from "./fundingMath.js";
import { ALL_TIMEFRAMES, bucketStart, nextBucket, isSecondTimeframe, timeframeSeconds } from "./timeframes.js";

export const AGGREGATED_OI_EXCHANGES = ["binance", "bybit", "okx", "gate", "mexc", "bitget", "bingx", "kucoin", "kraken", "htx",
  "hyperliquid", "aster", "deribit", "lighter", "paradex", "coinex", "bitmex"];
export const OI_HISTORY_EXCHANGES = ["binance", "bybit", "okx", "gate"];
const MAX_BARS = 1500;

/** Native OI-history interval (ms) used for a chart timeframe. */
export function nativeInterval(timeframe) {
  if (isSecondTimeframe(timeframe) || ["1m", "3m", "5m"].includes(timeframe)) return 300_000;
  if (timeframe === "15m") return 900_000;
  if (timeframe === "30m") return 1_800_000;
  if (timeframe === "1h") return 3_600_000;
  if (timeframe === "4h") return 14_400_000;
  return 86_400_000;
}
const LABELS = {
  binance: { 300_000: "5m", 900_000: "15m", 1_800_000: "30m", 3_600_000: "1h", 14_400_000: "4h", 86_400_000: "1d" },
  bybit: { 300_000: "5min", 900_000: "15min", 1_800_000: "30min", 3_600_000: "1h", 14_400_000: "4h", 86_400_000: "1d" },
  okx: { 300_000: "5m", 900_000: "15m", 1_800_000: "30m", 3_600_000: "1H", 14_400_000: "4H", 86_400_000: "1D" },
  gate: { 300_000: "5m", 900_000: "15m", 1_800_000: "30m", 3_600_000: "1h", 14_400_000: "4h", 86_400_000: "1d" },
};

/** OI history of one contract, in coins (same single-sided basis as the live inventory). */
export async function fetchContractOiHistory(request, item, interval, now) {
  const divisor = canonicalAsset(item.exchangeAsset ?? item.asset).priceDivisor || 1;
  const label = LABELS[item.exchange]?.[interval];
  if (!label) return [];
  const out = [];
  const push = (timestamp, coins) => {
    const t = number(timestamp), c = number(coins);
    if (t !== null && c !== null && c >= 0 && t <= now) out.push({ timestamp: t, oiCoin: c * divisor });
  };
  if (item.exchange === "binance") {
    // Up to 500 points (Binance keeps the last 30 days).
    const rows = await request(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${encodeURIComponent(item.symbol)}&period=${label}&limit=500`);
    if (!Array.isArray(rows)) throw new Error("Invalid Binance OI history");
    for (const row of rows) push(row.timestamp, row.sumOpenInterest);
  } else if (item.exchange === "bybit") {
    let cursor = "";
    for (let page = 0; page < 3; page++) {
      const body = await request(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${encodeURIComponent(item.symbol)}&intervalTime=${label}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      const list = body?.result?.list;
      if (!Array.isArray(list)) throw new Error("Invalid Bybit OI history");
      // Bybit documents openInterest as both sides; the live inventory is single-sided.
      for (const row of list) push(row.timestamp, number(row.singleOpenInterest) ?? (number(row.openInterest) !== null ? number(row.openInterest) / 2 : null));
      cursor = body.result.nextPageCursor;
      if (!cursor || list.length < 200) break;
    }
  } else if (item.exchange === "okx") {
    let end = "";
    for (let page = 0; page < 5; page++) {
      const body = await request(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=${encodeURIComponent(item.symbol)}&period=${label}&limit=100${end ? `&end=${end}` : ""}`);
      if (!Array.isArray(body?.data) || String(body.code) !== "0") throw new Error("Invalid OKX OI history");
      // [ts, oi (contracts), oiCcy (coins), oiUsd]
      for (const row of body.data) push(row[0], row[2]);
      if (body.data.length < 100) break;
      end = body.data.at(-1)[0];
    }
  } else if (item.exchange === "gate") {
    if (!(item.contractSizeCoin > 0)) return [];
    const step = interval / 1000;
    for (let page = 0; page < 5; page++) {
      const from = Math.floor(now / 1000) - (page + 1) * 100 * step;
      const rows = await request(`https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${encodeURIComponent(item.symbol)}&from=${from}&interval=${label}&limit=100`);
      if (!Array.isArray(rows)) throw new Error("Invalid Gate OI history");
      // Gate stats count both sides; the live inventory is single-sided.
      for (const row of rows) push(number(row.time) === null ? null : number(row.time) * 1000, number(row.open_interest) === null ? null : number(row.open_interest) * item.contractSizeCoin / 2);
      if (rows.length < 100) break;
    }
  }
  return [...new Map(out.map(point => [point.timestamp, point])).values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Build chained OI candles (coins) on chart buckets.
 * @param series [{key, points: [{timestamp (ms), oiCoin}]}] per contract
 * @param currentTotal real current total (coins) of all exchanges, the anchor
 */
export function buildAggregatedOiCandles(series, timeframe, now, currentTotal = null) {
  const events = [];
  for (const { key, points } of series) for (const point of points) {
    if (Number.isFinite(point.timestamp) && point.timestamp <= now && Number.isFinite(point.oiCoin) && point.oiCoin >= 0) events.push([point.timestamp, key, point.oiCoin]);
  }
  if (!events.length) return [];
  events.sort((a, b) => a[0] - b[0]);
  const last = new Map(); // latest value per contract
  const raw = [];
  let index = 0;
  // Only the last MAX_BARS buckets are built; older samples just set the starting values.
  const earliest = bucketStart(timeframe, Math.floor(now / 1000) - (MAX_BARS + 1) * timeframeSeconds(timeframe));
  let bucket = Math.max(bucketStart(timeframe, Math.floor(events[0][0] / 1000)), earliest);
  while (index < events.length && events[index][0] < bucket * 1000) { last.set(events[index][1], events[index][2]); index++; }
  for (; bucket * 1000 <= now; bucket = nextBucket(timeframe, bucket)) {
    const end = nextBucket(timeframe, bucket) * 1000;
    const known = new Map(last); // values at the bucket open
    const touched = new Set();
    let high = -Infinity, low = Infinity;
    // Contracts measured in this bucket: known at the open AND updated inside.
    const sumOf = keys => { let total = 0; for (const key of keys) total += last.get(key); return total; };
    const pending = [];
    while (index < events.length && events[index][0] < end) pending.push(events[index++]);
    for (const [, key, value] of pending) { last.set(key, value); if (known.has(key)) touched.add(key); }
    if (!touched.size) { raw.push({ time: bucket, empty: true, seed: known.size ? [...known.values()].reduce((a, b) => a + b, 0) : null }); continue; }
    // Replay the bucket for high/low on the measured contracts only.
    const live = new Map([...known].filter(([key]) => touched.has(key)));
    const open = [...live.values()].reduce((a, b) => a + b, 0);
    high = open; low = open;
    for (const [, key, value] of pending) {
      if (!live.has(key)) continue;
      live.set(key, value);
      const total = [...live.values()].reduce((a, b) => a + b, 0);
      high = Math.max(high, total); low = Math.min(low, total);
    }
    raw.push({ time: bucket, open, high, low, close: sumOf(touched), sources: touched.size });
  }
  // Chain, fill, anchor.
  // Start at the first bucket with a known level (a real candle, or flat from earlier samples).
  const firstReal = raw.findIndex(bar => !bar.empty || bar.seed > 0);
  if (firstReal < 0) return [];
  let level = raw[firstReal].empty ? raw[firstReal].seed : raw[firstReal].open;
  const out = [];
  for (const bar of raw.slice(firstReal)) {
    if (bar.empty) { out.push({ time: bar.time, open: level, high: level, low: level, close: level, filled: true }); continue; }
    const scale = bar.open > 0 ? level / bar.open : 1;
    const close = bar.close * scale;
    out.push({ time: bar.time, open: level, high: Math.max(level, close, bar.high * scale), low: Math.min(level, close, bar.low * scale), close, sources: bar.sources });
    level = close;
  }
  const anchor = currentTotal > 0 && level > 0 ? currentTotal / level : 1;
  return out.slice(-MAX_BARS).map(bar => ({ ...bar, open: bar.open * anchor, high: bar.high * anchor, low: bar.low * anchor, close: bar.close * anchor }));
}

export function createAggregatedOiService({ inputs = getOiChartInputs, request = requestJson, now = Date.now } = {}) {
  const historyCache = new Map(); // `${exchange}:${symbol}:${interval}` → {at, points, pending}
  const ttl = interval => Math.min(10 * 60_000, Math.max(60_000, interval / 5));
  function history(item, interval) {
    const key = `${item.exchange}:${item.symbol}:${interval}`;
    const entry = historyCache.get(key);
    if (entry && (entry.pending || now() - entry.at < ttl(interval))) return entry;
    const next = { at: entry?.at ?? 0, points: entry?.points ?? [], pending: null, failed: entry?.failed ?? false };
    next.pending = fetchContractOiHistory(request, item, interval, now())
      .then(points => { next.points = points; next.at = now(); next.failed = false; })
      .catch(() => { next.at = now(); next.failed = true; })
      .finally(() => { next.pending = null; });
    historyCache.set(key, next);
    if (historyCache.size > 3000) historyCache.delete(historyCache.keys().next().value);
    return next;
  }
  async function get(query) {
    const asset = typeof query.asset === "string" ? canonicalAsset(query.asset.trim().toUpperCase()).asset : "";
    const timeframe = query.timeframe ?? "1h";
    if (!/^[A-Z0-9]{1,30}$/.test(asset) || !isCryptoAsset(asset) || !ALL_TIMEFRAMES.includes(timeframe))
      throw Object.assign(new Error("A crypto asset and a chart timeframe are required."), { status: 400 });
    const { contracts } = inputs(asset, AGGREGATED_OI_EXCHANGES);
    const interval = nativeInterval(timeframe);
    const entries = contracts.filter(item => OI_HISTORY_EXCHANGES.includes(item.exchange)).map(item => [item, history(item, interval)]);
    // First load waits (briefly) for the exchange history; later loads use the cache.
    const waiting = entries.filter(([, entry]) => entry.pending && !entry.points.length).map(([, entry]) => entry.pending);
    if (waiting.length) await Promise.race([Promise.all(waiting), new Promise(resolve => setTimeout(resolve, 8000))]);
    const time = now();
    const series = contracts.map(item => {
      const native = entries.find(([entry]) => entry === item)?.[1]?.points ?? [];
      // Recorded samples (every exchange) + native history + the live value now.
      const live = Number.isFinite(item.oiCoin) ? [{ timestamp: Math.min(time, item.fetchedAt ?? time), oiCoin: item.oiCoin }] : [];
      return { key: `${item.exchange}:${item.symbol}`, points: [...native, ...(item.points ?? []), ...live] };
    });
    const currentTotal = contracts.reduce((sum, item) => sum + (Number.isFinite(item.oiCoin) ? item.oiCoin : 0), 0);
    const candles = buildAggregatedOiCandles(series, timeframe, time, currentTotal);
    const byExchange = {};
    for (const item of contracts) byExchange[item.exchange] = (byExchange[item.exchange] ?? 0) + (item.oiCoin || 0);
    return {
      asset, timeframe, unit: "coin", candles,
      current: { oiCoin: currentTotal, oiUsd: contracts.reduce((sum, item) => sum + (item.oiUsd || 0), 0) },
      exchanges: Object.entries(byExchange).filter(([, coins]) => coins > 0).map(([exchange, coins]) => ({ exchange, oiCoin: coins,
        history: OI_HISTORY_EXCHANGES.includes(exchange) ? "native + recorded" : "recorded" })),
      isLoading: entries.some(([, entry]) => entry.pending), generatedAt: new Date(time).toISOString(),
    };
  }
  return { get };
}

export const aggregatedOiService = createAggregatedOiService();
