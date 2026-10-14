import { requestJson } from "./exchangeRequests.js";
import { marketContractService } from "./marketContracts.js";
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";

export const CVD_EXCHANGES = ["binance", "bybit", "okx", "gate", "mexc", "bitget", "bingx", "kucoin", "kraken", "htx"];
export const SPOT_URLS = {
  binance: "https://api.binance.com/api/v3/exchangeInfo",
  bybit: "https://api.bybit.com/v5/market/instruments-info?category=spot",
  okx: "https://www.okx.com/api/v5/public/instruments?instType=SPOT",
  gate: "https://api.gateio.ws/api/v4/spot/currency_pairs",
  mexc: "https://api.mexc.com/api/v3/exchangeInfo",
  bitget: "https://api.bitget.com/api/v2/spot/public/symbols",
  bingx: "https://open-api.bingx.com/openApi/spot/v1/common/symbols",
  kucoin: "https://api.kucoin.com/api/v2/symbols",
  kraken: "https://api.kraken.com/0/public/AssetPairs",
  htx: "https://api.huobi.pro/v1/common/symbols",
};
const PERP_URLS = {
  kucoin: "https://api-futures.kucoin.com/api/v1/contracts/active",
  kraken: "https://futures.kraken.com/derivatives/api/v3/instruments",
  htx: "https://api.hbdm.com/linear-swap-api/v1/swap_contract_info",
};
const baseAlias = base => base === "XBT" || base === "XXBT" ? "BTC" : base === "XETH" ? "ETH" : base;

export function parseCvdMarkets(exchange, market, body) {
  let rows = exchange === "binance" || exchange === "mexc" ? body.symbols :
    exchange === "bybit" ? body.result?.list : exchange === "gate" ? body :
    exchange === "bingx" ? body.data?.symbols ?? body.data :
    exchange === "kraken" ? market === "spot" ? Object.values(body.result ?? {}) : body.instruments : body.data;
  if (!Array.isArray(rows)) throw new Error("Trade-market catalogue unavailable.");
  const markets = [];
  for (const r of rows) {
    let symbol, base, quote, allowed = false, contractSize = 1;
    if (market === "perpetual") {
      if (exchange === "kucoin") {
        symbol = r.symbol; base = r.baseCurrency; quote = r.quoteCurrency;
        contractSize = Number(r.multiplier);
        allowed = r.status === "Open" && !r.isInverse && /M$/.test(symbol ?? "");
      } else if (exchange === "kraken") {
        symbol = r.symbol; base = symbol?.match(/^PF_(.+)USD$/)?.[1]; quote = "USD";
        contractSize = Number(r.contractSize);
        allowed = r.tradeable !== false && /^PF_[A-Z0-9]+USD$/.test(symbol ?? "");
      } else if (exchange === "htx") {
        symbol = r.contract_code; base = r.symbol; quote = symbol?.split("-").at(-1);
        contractSize = Number(r.contract_size); allowed = r.contract_status === 1;
      }
    } else {
      switch (exchange) {
        case "binance": case "mexc":
          symbol = r.symbol; base = r.baseAsset; quote = r.quoteAsset;
          allowed = ["TRADING", "ENABLED", "1", 1].includes(r.status); break;
        case "bybit":
          symbol = r.symbol; base = r.baseCoin; quote = r.quoteCoin; allowed = r.status === "Trading"; break;
        case "okx":
          symbol = r.instId; base = r.baseCcy; quote = r.quoteCcy; allowed = r.state === "live"; break;
        case "gate":
          symbol = r.id; base = r.base; quote = r.quote; allowed = r.trade_status === "tradable"; break;
        case "bitget":
          symbol = r.symbol; base = r.baseCoin; quote = r.quoteCoin; allowed = r.status === "online"; break;
        case "bingx":
          symbol = r.symbol; base = symbol?.split("-")[0]; quote = symbol?.split("-")[1];
          allowed = r.status === 1 || r.status === undefined; break;
        case "kucoin":
          symbol = r.symbol; base = r.baseCurrency; quote = r.quoteCurrency; allowed = r.enableTrading === true; break;
        case "kraken":
          symbol = r.wsname?.replace(/^XBT\//, "BTC/"); base = r.wsname?.split("/")[0]; quote = r.wsname?.split("/")[1];
          allowed = r.status === "online"; break;
        case "htx":
          symbol = r.symbol; base = r["base-currency"]?.toUpperCase(); quote = r["quote-currency"]?.toUpperCase();
          allowed = r.state === "online"; break;
      }
    }
    base = typeof base === "string" ? baseAlias(base.toUpperCase()) : "";
    if (!allowed || !["USDT", "USD", "USDC"].includes(quote) ||
      typeof symbol !== "string" || !/^[a-zA-Z0-9_/-]{2,45}$/.test(symbol) ||
      !(contractSize > 0 && Number.isFinite(contractSize)) || !isCryptoAsset(base, symbol)) continue;
    const identity = canonicalAsset(base);
    markets.push({ exchange, market, symbol, asset: identity.asset, quote, contractSize, priceDivisor: identity.priceDivisor });
  }
  return markets;
}

export function createCvdMarketResolver({ request = requestJson, catalogue = marketContractService, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  async function resolve(exchange, market, asset) {
    if (!CVD_EXCHANGES.includes(exchange) || !["spot", "perpetual"].includes(market)) throw new Error("Unsupported trade market.");
    let markets;
    if (market === "perpetual" && !PERP_URLS[exchange]) {
      const state = catalogue.get();
      const source = state.sources.find(s => s.exchange === exchange);
      if (!source || source.status === "loading") throw Object.assign(new Error("Contract metadata loading."), { loading: true });
      if (source.status !== "ok") throw new Error("Contract metadata unavailable.");
      markets = state.contracts.filter(c => c.exchange === exchange)
        .map(c => ({ ...c, market, quote: "USDT" }));
    } else {
      const key = `${exchange}:${market}`, cached = cache.get(key);
      if (cached && cached.until > now()) {
        if (cached.error) throw cached.error;
        markets = cached.markets;
      } else {
        if (!pending.has(key)) pending.set(key, (async () => {
          try {
            const body = await request(market === "spot" ? SPOT_URLS[exchange] : PERP_URLS[exchange]);
            const list = parseCvdMarkets(exchange, market, body);
            cache.set(key, { markets: list, until: now() + 3600_000 }); return list;
          } catch (error) { cache.set(key, { error, until: now() + 300_000 }); throw error; }
          finally { pending.delete(key); }
        })());
        markets = await pending.get(key);
      }
    }
    // One verified liquid quote market per venue, never synthetic symbols.
    // Kraken's primary USD market avoids replacing its liquid book with a thin USDT book.
    const quoteOrder = exchange === "kraken" ? ["USD", "USDT", "USDC"] : ["USDT", "USDC", "USD"];
    return markets.filter(m => m.asset === asset)
      .sort((a, b) => quoteOrder.indexOf(a.quote) - quoteOrder.indexOf(b.quote) || a.priceDivisor - b.priceDivisor)[0] ?? null;
  }
  return { resolve };
}
