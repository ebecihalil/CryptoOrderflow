import { parseGateVolumeRows } from "./candleVolumeMath.js";

const durations = { "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "24h": 86400 };
const okxBars = { "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "24h": "1Dutc" };
const bitgetBars = { ...okxBars };
const mexcBars = { "5m": "Min5", "15m": "Min15", "30m": "Min30", "1h": "Min60", "4h": "Hour4", "24h": "Day1" };

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
  throw new Error("Unsupported candle adapter.");
}

export async function fetchVenueCandles(request, exchange, contract, timeframe, now) {
  const symbol = encodeURIComponent(contract.symbol);
  let url;
  if (exchange === "okx") url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${okxBars[timeframe]}&limit=300`;
  else if (exchange === "gate") url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${symbol}&interval=${timeframe === "24h" ? "1d" : timeframe}&limit=1000`;
  else if (exchange === "bitget") url = `https://api.bitget.com/api/v2/mix/market/candles?symbol=${symbol}&productType=USDT-FUTURES&granularity=${bitgetBars[timeframe]}&limit=1000`;
  else if (exchange === "mexc") url = `https://contract.mexc.com/api/v1/contract/kline/${symbol}?interval=${mexcBars[timeframe]}&start=${Math.floor(now / 1000) - 1000 * durations[timeframe]}&end=${Math.floor(now / 1000)}`;
  else if (exchange === "bingx") url = `https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${symbol}&interval=${timeframe === "24h" ? "1d" : timeframe}&limit=1000`;
  else throw new Error("Unsupported candle exchange.");
  return parseVenueCandles(exchange, await request(url), contract);
}
