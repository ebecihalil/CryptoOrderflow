// 24h tickers (last price, 24h change %, 24h quote volume) for every USDT
// perpetual on the Super Charts venues, for the market list. ONE bulk request
// per exchange per refresh, shared by all visitors and only while someone has
// the list open, through the same per-exchange request gates as everything else.
import { requestJson, requestGates } from "./exchangeRequests.js";
import { CHART_VENUES } from "./marketContracts.js";

const URLS = {
  binance: "https://fapi.binance.com/fapi/v1/ticker/24hr",
  bybit: "https://api.bybit.com/v5/market/tickers?category=linear",
  okx: "https://www.okx.com/api/v5/market/tickers?instType=SWAP",
  gate: "https://api.gateio.ws/api/v4/futures/usdt/tickers",
  mexc: "https://contract.mexc.com/api/v1/contract/ticker",
  bitget: "https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES",
  bingx: "https://open-api.bingx.com/openApi/swap/v2/quote/ticker",
};
// Binance bulk 24h ticker is a heavy call (weight 40): refresh it less often.
export const TICKER_REFRESH_MS = { binance: 60_000, default: 30_000 };
const IDLE_MS = 5 * 60_000;

const num = value => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const pct = (last, open) => last !== null && open > 0 ? (last / open - 1) * 100 : null;

/** Parse one exchange's bulk ticker body into [symbol, last, change% (percent units), quote volume USD]. */
export function parseTickers(exchange, body) {
  const rows = exchange === "binance" || exchange === "gate" ? body
    : exchange === "bybit" ? body?.result?.list : body?.data;
  if (!Array.isArray(rows)) throw new Error(`${exchange} tickers unavailable.`);
  if (["okx", "bitget", "bingx"].includes(exchange) && Number(body.code) !== 0) throw new Error(`${exchange} tickers rejected.`);
  const out = [];
  for (const row of rows) {
    let symbol, last, change, volume;
    switch (exchange) {
      case "binance": symbol = row.symbol; last = num(row.lastPrice); change = num(row.priceChangePercent); volume = num(row.quoteVolume); break;
      case "bybit": symbol = row.symbol; last = num(row.lastPrice);
        change = num(row.price24hPcnt) !== null ? num(row.price24hPcnt) * 100 : pct(last, num(row.prevPrice24h)); volume = num(row.turnover24h); break;
      case "okx": symbol = row.instId; last = num(row.last); change = pct(last, num(row.open24h));
        volume = num(row.volCcy24h) !== null && last ? num(row.volCcy24h) * last : null; break;
      case "gate": symbol = row.contract; last = num(row.last); change = num(row.change_percentage); volume = num(row.volume_24h_quote); break;
      case "mexc": symbol = row.symbol; last = num(row.lastPrice);
        change = num(row.riseFallRate) !== null ? num(row.riseFallRate) * 100 : null; volume = num(row.amount24); break;
      case "bitget": symbol = row.symbol; last = num(row.lastPr);
        change = num(row.change24h) !== null ? num(row.change24h) * 100 : pct(last, num(row.open24h)); volume = num(row.usdtVolume ?? row.quoteVolume); break;
      case "bingx": symbol = row.symbol; last = num(row.lastPrice); change = num(row.priceChangePercent); volume = num(row.quoteVolume); break;
      default: throw new Error("Unsupported ticker exchange.");
    }
    if (typeof symbol !== "string" || !(last > 0)) continue;
    out.push([symbol, last, change === null ? null : Math.round(change * 1000) / 1000, volume]);
  }
  return out;
}

export function createMarketTickerService({ request = requestJson, gates = requestGates, now = Date.now } = {}) {
  const states = new Map(Object.keys(CHART_VENUES).map(exchange =>
    [exchange, { rows: [], status: "loading", updatedAt: null, nextAttempt: 0, pending: null }]));
  let lastViewed = 0;

  function collect(exchange) {
    const state = states.get(exchange);
    if (state.pending || now() < state.nextAttempt || gates[exchange]?.isCoolingDown) return;
    state.pending = (async () => {
      try {
        state.rows = parseTickers(exchange, await request(URLS[exchange]));
        state.status = "ok"; state.updatedAt = now();
        state.nextAttempt = now() + (TICKER_REFRESH_MS[exchange] ?? TICKER_REFRESH_MS.default);
      } catch {
        // Keep the last good prices (marked stale); back off before retrying.
        state.status = state.rows.length ? "stale" : "unavailable";
        state.nextAttempt = Math.max(now() + 120_000, gates[exchange]?.blockedUntil ?? 0);
      }
    })().finally(() => { state.pending = null; });
  }

  /** Compact payload: per exchange, rows of [symbol, last, change%, volumeUsd]. */
  function get() {
    lastViewed = now();
    for (const exchange of states.keys()) collect(exchange);
    return {
      exchanges: Object.fromEntries([...states].map(([exchange, state]) => [exchange, {
        status: state.status, updatedAt: state.updatedAt ? new Date(state.updatedAt).toISOString() : null, rows: state.rows,
      }])),
      fields: ["symbol", "last", "changePercent", "volumeUsd"],
      generatedAt: new Date(now()).toISOString(),
    };
  }
  return { get, idle: () => now() - lastViewed > IDLE_MS, _states: states };
}

export const marketTickerService = createMarketTickerService();
