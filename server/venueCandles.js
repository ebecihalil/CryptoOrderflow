import { parseGateVolumeRows } from "./candleVolumeMath.js";

// Native intervals only; other timeframes are built in chartCandles.derivedFrom.
const durations = { "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "24h": 86400 };
export const okxBars = { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "24h": "1Dutc",
  "1w": "1Wutc", "1mo": "1Mutc", "3mo": "3Mutc" };
const bitgetBars = { ...okxBars };
const mexcBars = { "1m": "Min1", "5m": "Min5", "15m": "Min15", "30m": "Min30", "1h": "Min60", "4h": "Hour4", "24h": "Day1" };
const bingxBars = { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "24h": "1d" };
// Aster is Binance-compatible (1w = Monday UTC, 1M = calendar month, as Binance).
const asterBars = { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "24h": "1d", "1w": "1w", "1mo": "1M" };
const hyperliquidBars = { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "24h": "1d" };
const kucoinMinutes = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "24h": 1440 };
const htxPeriods = { "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "60min", "4h": "4hour", "24h": "1day" };
/** Native timeframes per new venue (others are built from these by chartCandles.derivedFrom). */
export const VENUE_NATIVE_FRAMES = { aster: Object.keys(asterBars), hyperliquid: Object.keys(hyperliquidBars),
  kucoin: Object.keys(kucoinMinutes), htx: Object.keys(htxPeriods) };
/** Venues that skip candles with no trades: missing buckets are filled as flat, zero-volume bars. */
export const GAP_FILL_VENUES = ["hyperliquid", "kucoin", "htx"];

/** Return Binance-shaped OHLCV rows, with volume in this native base asset. */
export function parseVenueCandles(exchange, body, contract) {
  if (["okx", "bitget", "bingx"].includes(exchange) && Number(body.code) !== 0)
    throw new Error("Exchange rejected candle request.");
  if (exchange === "gate") return parseGateVolumeRows(body, contract.contractSize);
  if (exchange === "okx") {
    if (!Array.isArray(body.data)) throw new Error("Invalid OKX candles.");
    // Index 5 is contracts; index 6 is base-currency volume for swaps.
    return body.data.map(row => {
      if (!Array.isArray(row) || row.length < 7) throw new Error("Missing OKX base volume.");
      return [row[0], row[1], row[2], row[3], row[4], row[6]];
    });
  }
  if (exchange === "bitget") {
    if (!Array.isArray(body.data)) throw new Error("Invalid Bitget candles.");
    return body.data;
  }
  if (exchange === "bingx") {
    if (!Array.isArray(body.data)) throw new Error("Invalid BingX candles.");
    return body.data.map(row => [row.time, row.open, row.high, row.low, row.close, row.volume]);
  }
  if (exchange === "mexc") {
    const data = body.data, fields = ["time", "open", "high", "low", "close", "vol"];
    if (body.success !== true || !data || !(contract.contractSize > 0) ||
      !fields.every(field => Array.isArray(data[field]) && data[field].length === data.time?.length))
      throw new Error("Invalid MEXC candle/contract units.");
    return data.time.map((time, i) => [Number(time) * 1000, data.open[i], data.high[i],
      data.low[i], data.close[i], data.vol[i] === null || data.vol[i] === "" ? NaN : Number(data.vol[i]) * contract.contractSize]);
  }
  if (exchange === "aster") {
    if (!Array.isArray(body)) throw new Error("Invalid Aster candles.");
    return body; // Binance kline rows
  }
  if (exchange === "hyperliquid") {
    if (!Array.isArray(body)) throw new Error("Invalid Hyperliquid candles.");
    return body.map(row => [row.t, row.o, row.h, row.l, row.c, row.v]);
  }
  if (exchange === "kucoin") {
    if (!Array.isArray(body.data)) throw new Error("Invalid KuCoin candles.");
    // [time ms, open, high, low, close, volume in lots]; a lot = `multiplier` coins.
    return body.data.map(row => [row[0], row[1], row[2], row[3], row[4], Number(row[5]) * (contract.contractSize || 1)]);
  }
  if (exchange === "htx") {
    if (!Array.isArray(body.data)) throw new Error("Invalid HTX candles.");
    // id = open time in seconds; amount = coins traded.
    return body.data.map(row => [row.id * 1000, row.open, row.high, row.low, row.close, row.amount]);
  }
  throw new Error("Unsupported candle adapter.");
}

/** Fill missing buckets (no trades) with flat bars at the previous close and zero volume. */
export function fillCandleGaps(rows, stepMs) {
  const sorted = [...rows].map(row => row.map(Number)).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const row of sorted) {
    const previous = out.at(-1);
    if (previous && row[0] <= previous[0]) continue;
    if (previous) for (let time = previous[0] + stepMs; time < row[0] && out.length < 5000; time += stepMs)
      out.push([time, previous[4], previous[4], previous[4], previous[4], 0]);
    out.push(row);
  }
  return out;
}

export async function fetchVenueCandles(request, exchange, contract, timeframe, now) {
  const symbol = encodeURIComponent(contract.symbol);
  let url;
  if (exchange === "okx") url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${okxBars[timeframe]}&limit=300`;
  else if (exchange === "gate") url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${symbol}&interval=${timeframe === "24h" ? "1d" : timeframe}&limit=1000`;
  else if (exchange === "bitget") url = `https://api.bitget.com/api/v2/mix/market/candles?symbol=${symbol}&productType=USDT-FUTURES&granularity=${bitgetBars[timeframe]}&limit=1000`;
  else if (exchange === "mexc") url = `https://contract.mexc.com/api/v1/contract/kline/${symbol}?interval=${mexcBars[timeframe]}&start=${Math.floor(now / 1000) - 1000 * durations[timeframe]}&end=${Math.floor(now / 1000)}`;
  else if (exchange === "bingx") url = `https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${symbol}&interval=${bingxBars[timeframe]}&limit=1000`;
  else if (exchange === "aster") url = `https://fapi.asterdex.com/fapi/v1/klines?symbol=${symbol}&interval=${asterBars[timeframe]}&limit=1000`;
  else if (exchange === "kucoin") {
    const minutes = kucoinMinutes[timeframe];
    url = `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${symbol}&granularity=${minutes}&from=${now - 500 * minutes * 60_000}&to=${now}`;
  } else if (exchange === "htx") url = `https://api.hbdm.com/linear-swap-ex/market/history/kline?contract_code=${symbol}&period=${htxPeriods[timeframe]}&size=1000`;
  else if (exchange !== "hyperliquid") throw new Error("Unsupported candle exchange.");
  const body = exchange === "hyperliquid"
    ? await request("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "candleSnapshot", req: { coin: contract.symbol, interval: hyperliquidBars[timeframe],
        startTime: now - 1000 * durations[timeframe] * 1000, endTime: now } }) })
    : await request(url);
  const rows = parseVenueCandles(exchange, body, contract);
  return GAP_FILL_VENUES.includes(exchange) ? fillCandleGaps(rows, durations[timeframe] * 1000) : rows;
}
