// Per-venue history adapters for the Aggregated Leverage Estimate.
// Every request goes through the shared exchange HTTP client, so the shared
// per-exchange gates, cooldowns and Binance routing/geo-block rules apply.
//
// Each adapter returns bars keyed by UTC bar-start (ms) with only fields the
// venue actually reports. Missing values are omitted, never zero-filled.
import { requestJson } from "./exchangeRequests.js";

export const LEVERAGE_TIMEFRAMES = {
  "5m": { ms: 300_000, binance: "5m", okx: "5m", gate: "5m", bybitOi: "5min", bybitKline: "5", okxBar: "5m" },
  "15m": { ms: 900_000, binance: "15m", okx: "15m", gate: "15m", bybitOi: "15min", bybitKline: "15", okxBar: "15m" },
  "30m": { ms: 1_800_000, binance: "30m", okx: "30m", gate: "30m", bybitOi: "30min", bybitKline: "30", okxBar: "30m" },
  "1h": { ms: 3_600_000, binance: "1h", okx: "1H", gate: "1h", bybitOi: "1h", bybitKline: "60", okxBar: "1H" },
  "4h": { ms: 14_400_000, binance: "4h", okx: "4H", gate: "4h", bybitOi: "4h", bybitKline: "240", okxBar: "4H" },
  "1d": { ms: 86_400_000, binance: "1d", okx: "1D", gate: "1d", bybitOi: "1d", bybitKline: "D", okxBar: "1Dutc" },
};
export const LEVERAGE_EXCHANGES = ["binance", "okx", "gate", "bybit"];

const num = value => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const positive = value => { const n = num(value); return n !== null && n > 0 ? n : null; };
const barKey = (timestamp, ms) => Math.floor(timestamp / ms) * ms;

/** Mutable helper collecting partial bar fields per venue. */
function collector(ms) {
  const bars = new Map();
  return {
    set(timestamp, fields) {
      const ts = num(timestamp);
      if (ts === null || ts <= 0) return;
      const key = barKey(ts, ms);
      const bar = bars.get(key) ?? { time: key };
      for (const [name, value] of Object.entries(fields)) if (value !== null && value !== undefined) bar[name] = value;
      bars.set(key, bar);
    },
    list: () => [...bars.values()].sort((a, b) => a.time - b.time),
  };
}

// Ratio = long/short. Some venues report long and short shares instead.
const ratioFromShares = (long, short) => {
  const l = positive(long), s = positive(short);
  return l !== null && s !== null ? l / s : null;
};

async function settle(parts) {
  const results = await Promise.allSettled(parts);
  const errors = results.filter(item => item.status === "rejected").map(item => item.reason?.message ?? "request failed");
  return { values: results.map(item => item.status === "fulfilled" ? item.value : null), errors };
}

// ---------- Binance USD-M (futures/data history: max 30 days, 500 rows) ----------
export async function fetchBinanceLeverage({ symbol, spotSymbol, timeframe, request = requestJson }) {
  const tf = LEVERAGE_TIMEFRAMES[timeframe], base = "https://fapi.binance.com/futures/data";
  const q = `symbol=${encodeURIComponent(symbol)}&period=${tf.binance}&limit=500`;
  const { values: [oi, topAcct, topPos, global, taker, spot], errors } = await settle([
    request(`${base}/openInterestHist?${q}`),
    request(`${base}/topLongShortAccountRatio?${q}`),
    request(`${base}/topLongShortPositionRatio?${q}`),
    request(`${base}/globalLongShortAccountRatio?${q}`),
    request(`${base}/takerlongshortRatio?${q}`),
    // Routed to data-api.binance.vision by default (not region-blocked).
    request(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(spotSymbol)}&interval=${tf.binance}&limit=500`),
  ]);
  if (!Array.isArray(oi)) throw new Error(errors[0] ?? "Binance OI history unavailable.");
  const out = collector(tf.ms);
  const contractPrice = new Map();
  for (const row of oi) {
    const coin = positive(row.sumOpenInterest), usd = positive(row.sumOpenInterestValue);
    if (coin === null || usd === null) continue;
    const key = barKey(num(row.timestamp), tf.ms);
    contractPrice.set(key, usd / coin);
    out.set(row.timestamp, { oiUsd: usd, price: usd / coin });
  }
  if (Array.isArray(topAcct)) for (const row of topAcct) out.set(row.timestamp, { topAccountRatio: positive(row.longShortRatio) });
  if (Array.isArray(topPos)) for (const row of topPos) out.set(row.timestamp, { topPositionRatio: positive(row.longShortRatio) });
  if (Array.isArray(global)) for (const row of global) out.set(row.timestamp, { globalAccountRatio: positive(row.longShortRatio) });
  if (Array.isArray(taker)) for (const row of taker) {
    // buyVol/sellVol are in contract-asset units; value them at that bar's
    // OI-implied contract price so 1000x-denominated contracts stay correct.
    const price = contractPrice.get(barKey(num(row.timestamp), tf.ms));
    const buy = num(row.buyVol), sell = num(row.sellVol);
    if (price && buy !== null && sell !== null && buy >= 0 && sell >= 0) out.set(row.timestamp, { takerBuyUsd: buy * price, takerSellUsd: sell * price });
  }
  if (Array.isArray(spot)) for (const row of spot) out.set(row[0], { spotTurnoverUsd: positive(row[7]) });
  return { bars: out.list(), errors };
}

// ---------- OKX (rubik statistics: 100 rows; candles: 300 rows) ----------
export async function fetchOkxLeverage({ symbol, spotSymbol, timeframe, request = requestJson }) {
  const tf = LEVERAGE_TIMEFRAMES[timeframe], base = "https://www.okx.com/api/v5/rubik/stat";
  const id = encodeURIComponent(symbol);
  const { values: [oi, topAcct, topPos, global, taker, spot], errors } = await settle([
    request(`${base}/contracts/open-interest-history?instId=${id}&period=${tf.okx}&limit=100`),
    request(`${base}/contracts/long-short-account-ratio-contract-top-trader?instId=${id}&period=${tf.okx}&limit=100`),
    request(`${base}/contracts/long-short-position-ratio-contract-top-trader?instId=${id}&period=${tf.okx}&limit=100`),
    request(`${base}/contracts/long-short-account-ratio-contract?instId=${id}&period=${tf.okx}&limit=100`),
    // unit=2 reports taker sell/buy volume in USD (quote) value.
    request(`${base}/taker-volume-contract?instId=${id}&period=${tf.okx}&unit=2&limit=100`),
    request(`https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(spotSymbol)}&bar=${tf.okxBar}&limit=300`),
  ]);
  if (!Array.isArray(oi?.data)) throw new Error(errors[0] ?? "OKX OI history unavailable.");
  const out = collector(tf.ms);
  for (const row of oi.data) {
    const coin = positive(row[2]), usd = positive(row[3]);
    if (usd !== null) out.set(row[0], { oiUsd: usd, price: coin ? usd / coin : null });
  }
  for (const row of topAcct?.data ?? []) out.set(row[0], { topAccountRatio: positive(row[1]) });
  for (const row of topPos?.data ?? []) out.set(row[0], { topPositionRatio: positive(row[1]) });
  for (const row of global?.data ?? []) out.set(row[0], { globalAccountRatio: positive(row[1]) });
  for (const row of taker?.data ?? []) {
    const sell = num(row[1]), buy = num(row[2]);
    if (buy !== null && sell !== null && buy >= 0 && sell >= 0) out.set(row[0], { takerBuyUsd: buy, takerSellUsd: sell });
  }
  for (const row of spot?.data ?? []) out.set(row[0], { spotTurnoverUsd: positive(row[7]) });
  return { bars: out.list(), errors };
}

// ---------- Gate.io (contract_stats: OI, top-trader ratios, liquidations) ----------
export async function fetchGateLeverage({ symbol, spotSymbol, timeframe, request = requestJson }) {
  const tf = LEVERAGE_TIMEFRAMES[timeframe];
  const { values: [stats, spot], errors } = await settle([
    request(`https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${encodeURIComponent(symbol)}&interval=${tf.gate}&limit=100`),
    request(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(spotSymbol)}&interval=${tf.gate}&limit=500`),
  ]);
  if (!Array.isArray(stats)) throw new Error(errors[0] ?? "Gate contract statistics unavailable.");
  const out = collector(tf.ms);
  for (const row of stats) {
    const time = num(row.time);
    if (time === null) continue;
    out.set(time * 1000, {
      oiUsd: positive(row.open_interest_usd), price: positive(row.mark_price),
      topAccountRatio: positive(row.top_lsr_account), topPositionRatio: positive(row.top_lsr_size),
      globalAccountRatio: positive(row.lsr_account),
      longLiqUsd: num(row.long_liq_usd) !== null && num(row.long_liq_usd) >= 0 ? num(row.long_liq_usd) : null,
      shortLiqUsd: num(row.short_liq_usd) !== null && num(row.short_liq_usd) >= 0 ? num(row.short_liq_usd) : null,
    });
  }
  if (Array.isArray(spot)) for (const row of spot) {
    const time = num(row[0]);
    if (time !== null) out.set(time * 1000, { spotTurnoverUsd: positive(row[1]) });
  }
  return { bars: out.list(), errors };
}

// ---------- Bybit (OI in coin + linear price + global account ratio) ----------
export async function fetchBybitLeverage({ symbol, spotSymbol, timeframe, request = requestJson }) {
  const tf = LEVERAGE_TIMEFRAMES[timeframe], base = "https://api.bybit.com/v5/market";
  const s = encodeURIComponent(symbol);
  const { values: [oi, kline, global, spot], errors } = await settle([
    request(`${base}/open-interest?category=linear&symbol=${s}&intervalTime=${tf.bybitOi}&limit=200`),
    request(`${base}/kline?category=linear&symbol=${s}&interval=${tf.bybitKline}&limit=200`),
    request(`${base}/account-ratio?category=linear&symbol=${s}&period=${tf.bybitOi}&limit=200`),
    request(`${base}/kline?category=spot&symbol=${encodeURIComponent(spotSymbol)}&interval=${tf.bybitKline}&limit=500`),
  ]);
  if (!Array.isArray(oi?.result?.list) || !Array.isArray(kline?.result?.list))
    throw new Error(errors[0] ?? "Bybit OI history unavailable.");
  const out = collector(tf.ms);
  const closes = new Map();
  for (const row of kline.result.list) {
    const close = positive(row[4]);
    if (close !== null) closes.set(barKey(num(row[0]), tf.ms), close);
  }
  for (const row of oi.result.list) {
    const coin = positive(row.openInterest), key = barKey(num(row.timestamp), tf.ms);
    // Bybit OI snapshots are taken at the bar boundary; value with the close
    // of the bar that ended there, else the bar it opens.
    const price = closes.get(key - tf.ms) ?? closes.get(key);
    if (coin !== null && price) out.set(row.timestamp, { oiUsd: coin * price, price });
  }
  for (const row of global?.result?.list ?? []) out.set(row.timestamp, { globalAccountRatio: ratioFromShares(row.buyRatio, row.sellRatio) });
  for (const row of spot?.result?.list ?? []) out.set(row[0], { spotTurnoverUsd: positive(row[6]) });
  return { bars: out.list(), errors };
}

export const LEVERAGE_FETCHERS = {
  binance: fetchBinanceLeverage, okx: fetchOkxLeverage, gate: fetchGateLeverage, bybit: fetchBybitLeverage,
};

/** Spot symbol for a canonical asset on each venue (stablecoin quote). */
export function spotSymbolFor(exchange, asset) {
  return exchange === "okx" ? `${asset}-USDT` : exchange === "gate" ? `${asset}_USDT` : `${asset}USDT`;
}
