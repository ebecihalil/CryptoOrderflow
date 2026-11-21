// 24h tickers (last price, 24h change %, 24h quote volume) for every USDT
// perpetual on the Super Charts venues, for the market list. ONE bulk request
// per exchange per refresh, shared by all visitors and only while someone has
// the list open, through the same per-exchange request gates as everything else.
import { requestJson, requestGates } from "./exchangeRequests.js";
import { CHART_VENUES } from "./marketContracts.js";
import { createDailyOpenService } from "./dailyOpens.js";

const URLS = {
  binance: "https://fapi.binance.com/fapi/v1/ticker/24hr",
  bybit: "https://api.bybit.com/v5/market/tickers?category=linear",
  okx: "https://www.okx.com/api/v5/market/tickers?instType=SWAP",
  gate: "https://api.gateio.ws/api/v4/futures/usdt/tickers",
  mexc: "https://contract.mexc.com/api/v1/contract/ticker",
  bitget: "https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES",
  bingx: "https://open-api.bingx.com/openApi/swap/v2/quote/ticker",
  aster: "https://fapi.asterdex.com/fapi/v1/ticker/24hr",
  hyperliquid: "https://api.hyperliquid.xyz/info",
  kucoin: "https://api-futures.kucoin.com/api/v1/contracts/active",
  htx: "https://api.hbdm.com/linear-swap-ex/market/detail/batch_merged",
};
const fetchTickers = (request, exchange) => exchange === "hyperliquid"
  ? request(URLS.hyperliquid, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }) })
  : request(URLS[exchange]);
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
  if (exchange === "hyperliquid") {
    // [meta, assetContexts]: same order; change vs the previous day's price.
    const universe = body?.[0]?.universe, contexts = body?.[1];
    if (!Array.isArray(universe) || !Array.isArray(contexts)) throw new Error("hyperliquid tickers unavailable.");
    return universe.flatMap((coin, index) => {
      const ctx = contexts[index] ?? {}, last = num(ctx.markPx);
      return coin.isDelisted || !(last > 0) ? [] : [[coin.name, last, (() => { const c = pct(last, num(ctx.prevDayPx)); return c === null ? null : Math.round(c * 1000) / 1000; })(), num(ctx.dayNtlVlm)]];
    });
  }
  const rows = exchange === "binance" || exchange === "gate" || exchange === "aster" ? body
    : exchange === "bybit" ? body?.result?.list : exchange === "htx" ? body?.ticks ?? body?.data : body?.data;
  if (!Array.isArray(rows)) throw new Error(`${exchange} tickers unavailable.`);
  if (["okx", "bitget", "bingx"].includes(exchange) && Number(body.code) !== 0) throw new Error(`${exchange} tickers rejected.`);
  const out = [];
  for (const row of rows) {
    let symbol, last, change, volume, dayOpen = null;
    switch (exchange) {
      case "binance": symbol = row.symbol; last = num(row.lastPrice); change = num(row.priceChangePercent); volume = num(row.quoteVolume); break;
      case "bybit": symbol = row.symbol; last = num(row.lastPrice);
        change = num(row.price24hPcnt) !== null ? num(row.price24hPcnt) * 100 : pct(last, num(row.prevPrice24h)); volume = num(row.turnover24h); break;
      case "okx": symbol = row.instId; last = num(row.last); change = pct(last, num(row.open24h));
        volume = num(row.volCcy24h) !== null && last ? num(row.volCcy24h) * last : null; dayOpen = num(row.sodUtc0); break;
      case "gate": symbol = row.contract; last = num(row.last); change = num(row.change_percentage); volume = num(row.volume_24h_quote); break;
      case "mexc": symbol = row.symbol; last = num(row.lastPrice);
        change = num(row.riseFallRate) !== null ? num(row.riseFallRate) * 100 : null; volume = num(row.amount24); break;
      case "bitget": symbol = row.symbol; last = num(row.lastPr);
        change = num(row.change24h) !== null ? num(row.change24h) * 100 : pct(last, num(row.open24h)); volume = num(row.usdtVolume ?? row.quoteVolume);
        dayOpen = num(row.openUtc); break;
      case "bingx": symbol = row.symbol; last = num(row.lastPrice); change = num(row.priceChangePercent); volume = num(row.quoteVolume); break;
      case "aster": symbol = row.symbol; last = num(row.lastPrice); change = num(row.priceChangePercent); volume = num(row.quoteVolume); break;
      case "kucoin": symbol = row.symbol; last = num(row.lastTradePrice);
        change = num(row.priceChgPct) !== null ? num(row.priceChgPct) * 100 : null; volume = num(row.turnoverOf24h); break;
      case "htx": symbol = row.contract_code; last = num(row.close); change = pct(last, num(row.open)); volume = num(row.trade_turnover); break;
      default: throw new Error("Unsupported ticker exchange.");
    }
    if (typeof symbol !== "string" || !(last > 0)) continue;
    out.push(dayOpen > 0 ? [symbol, last, change === null ? null : Math.round(change * 1000) / 1000, volume, dayOpen]
      : [symbol, last, change === null ? null : Math.round(change * 1000) / 1000, volume]);
  }
  return out;
}

export function createMarketTickerService({ request = requestJson, gates = requestGates, now = Date.now, dailyOpens = createDailyOpenService({ request, now }) } = {}) {
  const states = new Map(Object.keys(CHART_VENUES).map(exchange =>
    [exchange, { rows: [], status: "loading", updatedAt: null, nextAttempt: 0, pending: null }]));
  let lastViewed = 0;

  function collect(exchange) {
    const state = states.get(exchange);
    if (state.pending || now() < state.nextAttempt || gates[exchange]?.isCoolingDown) return;
    state.pending = (async () => {
      try {
        state.rows = parseTickers(exchange, await fetchTickers(request, exchange));
        state.status = "ok"; state.updatedAt = now();
        state.nextAttempt = now() + (TICKER_REFRESH_MS[exchange] ?? TICKER_REFRESH_MS.default);
      } catch {
        // Keep the last good prices (marked stale); back off before retrying.
        state.status = state.rows.length ? "stale" : "unavailable";
        state.nextAttempt = Math.max(now() + 120_000, gates[exchange]?.blockedUntil ?? 0);
      }
    })().finally(() => { state.pending = null; });
  }

  /** Change since today's 00:00 UTC daily open (TradingView's watchlist basis), or null until known. */
  const sinceUtcOpen = (exchange, row) => {
    if (row[4] > 0) dailyOpens.set(exchange, row[0], row[4]);
    const open = row[4] > 0 ? row[4] : dailyOpens.get(exchange, row[0]);
    return open > 0 ? Math.round((row[1] / open - 1) * 100_000) / 1000 : null;
  };
  /** Compact payload: per exchange, rows of [symbol, last, change% (rolling 24h), volumeUsd, change% since 00:00 UTC]. */
  function get() {
    lastViewed = now();
    for (const exchange of states.keys()) collect(exchange);
    return {
      exchanges: Object.fromEntries([...states].map(([exchange, state]) => [exchange, {
        status: state.status, updatedAt: state.updatedAt ? new Date(state.updatedAt).toISOString() : null,
        rows: state.rows.map(row => [row[0], row[1], row[2], row[3], sinceUtcOpen(exchange, row)]),
      }])),
      fields: ["symbol", "last", "changePercent", "volumeUsd", "changePercentUtc"],
      generatedAt: new Date(now()).toISOString(),
    };
  }
  return { get, idle: () => now() - lastViewed > IDLE_MS, _states: states };
}

export const marketTickerService = createMarketTickerService();
