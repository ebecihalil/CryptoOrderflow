import { requestJson, requestGates } from "./exchangeRequests.js";
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";

export const CHART_VENUES = {
  binance: ["BINANCE", "Binance"], bybit: ["BYBIT", "Bybit"], okx: ["OKX", "OKX"],
  gate: ["GATEIO", "Gate.io"], mexc: ["MEXC", "MEXC"], bitget: ["BITGET", "Bitget"], bingx: ["BINGX", "BingX"],
};
const urls = {
  binance: "https://fapi.binance.com/fapi/v1/exchangeInfo",
  bybit: "https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000",
  okx: "https://www.okx.com/api/v5/public/instruments?instType=SWAP",
  gate: "https://api.gateio.ws/api/v4/futures/usdt/contracts",
  mexc: "https://contract.mexc.com/api/v1/contract/detail",
  bitget: "https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES",
  bingx: "https://open-api.bingx.com/openApi/swap/v2/quote/contracts",
};
export function parseMarketContracts(exchange, body) {
  const rows = exchange === "binance" ? body.symbols : exchange === "bybit" ? body.result?.list
    : exchange === "gate" ? body : body.data;
  if (!Array.isArray(rows)) throw new Error("Contract catalogue unavailable.");
  if (["okx", "bitget", "bingx"].includes(exchange) && Number(body.code) !== 0) throw new Error("Contract catalogue rejected.");
  const contracts = [];
  for (const row of rows) {
    let symbol, base, allowed = false, contractSize = 1;
    switch (exchange) {
      case "binance":
        symbol = row.symbol; base = row.baseAsset;
        allowed = row.status === "TRADING" && row.contractType === "PERPETUAL" && row.quoteAsset === "USDT"; break;
      case "bybit":
        symbol = row.symbol; base = row.baseCoin;
        allowed = row.status === "Trading" && row.contractType === "LinearPerpetual" && row.quoteCoin === "USDT"; break;
      case "okx":
        symbol = row.instId; base = row.ctValCcy;
        contractSize = Number(row.ctVal);
        allowed = row.state === "live" && row.instType === "SWAP" && row.settleCcy === "USDT" && symbol?.endsWith("-USDT-SWAP"); break;
      case "gate":
        symbol = row.name; base = symbol?.split("_")[0]; contractSize = Number(row.quanto_multiplier);
        allowed = !row.in_delisting && row.status !== "delisted" && symbol?.endsWith("_USDT"); break;
      case "mexc":
        symbol = row.symbol; base = row.baseCoin; contractSize = Number(row.contractSize);
        allowed = row.state === 0 && row.quoteCoin === "USDT"; break;
      case "bitget":
        symbol = row.symbol; base = row.baseCoin;
        allowed = row.symbolStatus === "normal" && row.symbolType === "perpetual" && row.quoteCoin === "USDT"; break;
      case "bingx":
        symbol = row.symbol; base = symbol?.split("-")[0];
        allowed = symbol?.endsWith("-USDT") && row.status === 1; break;
    }
    if (!allowed || typeof base !== "string" || typeof symbol !== "string" ||
      !/^[A-Z0-9_-]{2,45}$/.test(symbol) || !isCryptoAsset(base, symbol)) continue;
    const identity = canonicalAsset(base);
    contracts.push({ exchange, tvExchange: CHART_VENUES[exchange][0], label: `${base}USDT — ${CHART_VENUES[exchange][1]}`,
      symbol, ticker: `${base}USDT`, asset: identity.asset, exchangeAsset: base,
      priceDivisor: identity.priceDivisor, contractSize });
  }
  return [...new Map(contracts.map(contract => [contract.symbol, contract])).values()];
}

/** Metadata only. Search keystrokes never request individual contracts or prices. */
export function createMarketContractService({ request = requestJson, gates = requestGates, now = Date.now } = {}) {
  const states = new Map(Object.keys(CHART_VENUES).map(exchange =>
    [exchange, { contracts: [], status: "unavailable", nextAttempt: 0, pending: null }]));
  function collect(exchange) {
    const state = states.get(exchange);
    if (state.pending) return state.pending;
    if (now() < state.nextAttempt || gates[exchange]?.isCoolingDown) return Promise.resolve();
    state.status = "loading";
    state.pending = (async () => {
      try {
        let contracts = [], cursor = "";
        const visited = new Set();
        do {
          const body = await request(urls[exchange] + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
          contracts.push(...parseMarketContracts(exchange, body));
          cursor = exchange === "bybit" ? body.result?.nextPageCursor ?? "" : "";
          if (cursor && visited.has(cursor)) throw new Error("Repeated contract page.");
          visited.add(cursor);
          if (visited.size > 10) throw new Error("Too many contract pages.");
        } while (cursor);
        if (!contracts.length) throw new Error("No verified perpetual contracts.");
        state.contracts = [...new Map(contracts.map(item => [item.symbol, item])).values()];
        state.status = "ok"; state.nextAttempt = now() + 3_600_000;
      } catch {
        // Retain useful catalogue records but never mark failed refreshes as live.
        state.status = "unavailable";
        state.nextAttempt = Math.max(now() + 300_000, gates[exchange]?.blockedUntil ?? 0);
      }
    })().finally(() => { state.pending = null; });
    return state.pending;
  }
  function get() {
    for (const exchange of states.keys()) void collect(exchange);
    return {
      contracts: [...states.values()].flatMap(state => state.contracts),
      sources: [...states].map(([exchange, state]) => ({ exchange, status: state.status, coinCount: state.contracts.length })),
      isRefreshing: [...states.values()].some(state => state.pending !== null),
      generatedAt: new Date(now()).toISOString(),
    };
  }
  async function lookup(exchange, symbol) {
    if (!states.has(exchange)) throw Object.assign(new Error("Unsupported chart exchange."), { status: 400 });
    await collect(exchange);
    const state = states.get(exchange);
    const item = state.contracts.find(contract => contract.symbol === symbol || contract.ticker === symbol);
    if (!item) throw Object.assign(new Error(state.status === "ok" ? "This is not a verified crypto USDT perpetual contract."
      : "Contract metadata is currently unavailable."), { status: state.status === "ok" ? 400 : 503 });
    return item;
  }
  return { get, lookup };
}
export const marketContractService = createMarketContractService();
