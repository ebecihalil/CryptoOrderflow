import catalog from "../src/data/coin-logo-index.json" with { type: "json" };
import overrides from "../src/data/coin-logo-overrides.json" with { type: "json" };
import { canonicalAsset } from "./lsarMarketData.js";

// A positive crypto identity, not merely an unfamiliar ticker, is required.
// These identities already ship with the app: classification adds no API traffic.
const verified = new Set([...Object.keys(catalog.ids), ...Object.keys(overrides)]);
const nonCrypto = new Set([
    "NATGAS", "NGAS", "NG", "GVZ", "RUM", "XAU", "XAG", "XPT", "XPD",
    "UKOIL", "USOIL", "BRENT", "WTI", "SPX500", "NAS100", "SPY", "QQQ",
    "AAPL", "AMZN", "MSFT", "GOOGL", "GOOG", "META", "NVDA", "NVIDIA",
    "TSLA", "COIN", "COINBASE", "MSTR", "CRCL", "SNDK", "SKHY", "SKHYNIX",
    "SAMSUNG", "MU", "INTC", "AMD", "AVGO", "MRVL", "ORCL", "RBLX",
    "OPENAI", "ANTHROPIC", "SPCX", "EWY", "GBP", "ETN", "HPQ", "KOD",
    "SPIR", "SDGR", "KOPN", "NDX100", "SP500", "KORU", "SOXL", "TOYOTA",
    "NICKEL", "LEAD", "BLUEFOCUS", "CVNA", "CRML", "GRAL", "COIN50",
]);
const aliases = { XBT: "BTC", XDG: "DOGE", BTCPERP: "BTC", ETHPERP: "ETH", FILECOIN: "FIL", PUMPFUN: "PUMP" };
export function isCryptoAsset(asset) {
    const ticker = canonicalAsset(String(asset ?? "").trim().toUpperCase()).asset;
    if (nonCrypto.has(ticker) || ticker.endsWith("STOCK")) return false;
    return verified.has(aliases[ticker] ?? ticker);
}
