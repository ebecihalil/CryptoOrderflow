// Today's daily-candle open (00:00 UTC) per perpetual contract, so the market list can
// show the change "since 00:00 UTC" like TradingView's watchlist (exchange tickers only
// give a rolling 24-hour change). OKX and Bitget publish the UTC-midnight open in their
// tickers; for the other exchanges today's daily candle is fetched once per contract per
// day (spread out, through the shared per-exchange request gates) and kept until midnight.
import { requestJson } from "./exchangeRequests.js";
import { parseVenueCandles } from "./venueCandles.js";

export const dayStartMs = (now = Date.now()) => Math.floor(now / 86_400_000) * 86_400_000;

/** URL (or POST body) for one contract's daily candles starting today. */
function dailyRequest(exchange, symbol, start, now) {
  const s = encodeURIComponent(symbol);
  switch (exchange) {
    case "binance": return { url: `https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=1d&limit=1` };
    case "aster": return { url: `https://fapi.asterdex.com/fapi/v1/klines?symbol=${s}&interval=1d&limit=1` };
    case "bybit": return { url: `https://api.bybit.com/v5/market/kline?category=linear&symbol=${s}&interval=D&limit=1` };
    case "gate": return { url: `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${s}&interval=1d&limit=1` };
    case "mexc": return { url: `https://contract.mexc.com/api/v1/contract/kline/${s}?interval=Day1&start=${Math.floor(start / 1000)}&end=${Math.floor(now / 1000)}` };
    case "bingx": return { url: `https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${s}&interval=1d&limit=1` };
    case "kucoin": return { url: `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${s}&granularity=1440&from=${start}&to=${now}` };
    case "htx": return { url: `https://api.hbdm.com/linear-swap-ex/market/history/kline?contract_code=${s}&period=1day&size=1` };
    case "hyperliquid": return { url: "https://api.hyperliquid.xyz/info", init: { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "candleSnapshot", req: { coin: symbol, interval: "1d", startTime: start, endTime: now } }) } };
    default: return null;
  }
}

/** Open price of the daily candle that starts at `start` (ms), or null. */
export function parseDailyOpen(exchange, body, start) {
  let rows;
  if (exchange === "binance") rows = Array.isArray(body) ? body.map(row => [row[0], row[1]]) : [];
  else if (exchange === "bybit") rows = (body?.result?.list ?? []).map(row => [row[0], row[1]]);
  else rows = parseVenueCandles(exchange, body, { contractSize: 1 }).map(row => [row[0], row[1]]);
  const match = rows.find(row => Number(row[0]) === start);
  const open = match ? Number(match[1]) : NaN;
  return open > 0 ? open : null;
}

export function createDailyOpenService({ request = requestJson, now = Date.now, concurrency = 2 } = {}) {
  const opens = new Map(); // `${exchange}:${symbol}` -> {day, open}
  const queues = new Map(); // exchange -> Set(symbol)
  const running = new Map(); // exchange -> active requests
  const failed = new Map(); // key -> retry-after time
  function pump(exchange) {
    const queue = queues.get(exchange);
    while (queue?.size && (running.get(exchange) ?? 0) < concurrency) {
      const symbol = queue.values().next().value;
      queue.delete(symbol);
      const start = dayStartMs(now()), spec = dailyRequest(exchange, symbol, start, now());
      if (!spec) continue;
      running.set(exchange, (running.get(exchange) ?? 0) + 1);
      request(spec.url, spec.init)
        .then(body => {
          const open = parseDailyOpen(exchange, body, start);
          if (open) opens.set(`${exchange}:${symbol}`, { day: start, open });
          else failed.set(`${exchange}:${symbol}`, now() + 15 * 60_000);
        })
        .catch(() => failed.set(`${exchange}:${symbol}`, now() + 10 * 60_000))
        .finally(() => { running.set(exchange, running.get(exchange) - 1); pump(exchange); });
    }
  }
  return {
    /** Today's open for a contract (null until fetched); queues a fetch when missing. */
    get(exchange, symbol) {
      const key = `${exchange}:${symbol}`, entry = opens.get(key), today = dayStartMs(now());
      if (entry?.day === today) return entry.open;
      if (!dailyRequest(exchange, symbol, today, now()) || (failed.get(key) ?? 0) > now()) return null;
      if (!queues.has(exchange)) queues.set(exchange, new Set());
      queues.get(exchange).add(symbol);
      pump(exchange);
      return null;
    },
    /** Opens published by the exchange itself (OKX sodUtc0, Bitget openUtc). */
    set(exchange, symbol, open) { if (open > 0) opens.set(`${exchange}:${symbol}`, { day: dayStartMs(now()), open }); },
    pending: () => [...queues.values()].reduce((sum, queue) => sum + queue.size, 0),
  };
}
