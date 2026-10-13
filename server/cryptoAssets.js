import catalog from "../src/data/coin-logo-index.json" with { type: "json" };
import overrides from "../src/data/coin-logo-overrides.json" with { type: "json" };
import financial from "../src/data/financial-asset-identities.json" with { type: "json" };
import { canonicalAsset } from "./assetIdentity.js";

// A positive crypto identity, not merely an unfamiliar ticker, is required.
// These identities already ship with the app: classification adds no API traffic.
const verified = new Set([...Object.keys(catalog.ids), ...Object.keys(overrides)]);
const identities = { ...catalog.ids, ...Object.fromEntries(Object.entries(overrides).map(([ticker, entry]) => [ticker, entry.id])) };
const financialIds = new Set(financial.ids);
const nonCrypto = new Set([
    "NATGAS", "NGAS", "NG", "GVZ", "RUM", "XAU", "XAG", "XPT", "XPD",
    "UKOIL", "USOIL", "BRENT", "WTI", "SPX500", "NAS100", "SPY", "QQQ",
    "AAPL", "AMZN", "MSFT", "GOOGL", "GOOG", "META", "NVDA", "NVIDIA",
    "TSLA", "COIN", "COINBASE", "MSTR", "CRCL", "SNDK", "SKHY", "SKHYNIX",
    "SAMSUNG", "MU", "INTC", "AMD", "AVGO", "MRVL", "ORCL", "RBLX",
    "OPENAI", "ANTHROPIC", "SPCX", "EWY", "GBP", "ETN", "HPQ", "KOD",
    "SPIR", "SDGR", "KOPN", "NDX100", "SP500", "KORU", "SOXL", "TOYOTA",
    "NICKEL", "LEAD", "BLUEFOCUS", "CVNA", "CRML", "GRAL", "COIN50",
    "TESLA", "COST", "BRKB", "WDC", "AMZU", "AAPU", "US30", "US100", "US500",
    "BRENTOIL", "PLTR", "TSEM", "RGTI", "VRTX", "ISRG", "MRNA", "UNH",
    "CCL", "LLY", "MO", "NBIS", "NEM", "AMAT", "SMR", "TWLO", "HD", "DE",
    "CDNS", "LASERTEC", "KIOXIA", "BMNR", "BAC", "AMC", "ACN", "BX", "BKNG",
    "MCD", "MTSI", "FTNT", "DELL", "TTWO", "IREN", "AXTI", "KO", "NFLX",
    "UBER", "HOOD", "RBLX", "PEP", "DIS", "JPM", "V", "MA", "GS", "BA",
    "TLT", "IWM", "DIA", "TQQQ", "SQQQ", "UPRO", "SPXL", "SPXS", "SOXS",
    "ARKK", "GLD", "SLV", "GDX", "USO", "UNG", "EUR", "CHF", "JPY", "TRY",
    "SOXX", "IVV", "VOO", "ITOT", "IEFA", "IGV", "VGT", "VUG", "XLK", "XLV",
    "XLF", "XLI", "XLP", "XLU", "SPYM", "EWH", "DFEN", "INDA", "IBIT", "ETHA",
]);
const aliases = { XBT: "BTC", XDG: "DOGE", BTCPERP: "BTC", ETHPERP: "ETH", FILECOIN: "FIL", PUMPFUN: "PUMP",
    KPEPE: "PEPE", KBONK: "BONK", KSHIB: "SHIB", KDOGE: "DOGE", KFLOKI: "FLOKI" };
export function isNonCryptoAsset(asset) {
    let ticker = canonicalAsset(String(asset ?? "").trim().toUpperCase()).asset.split(":").at(-1);
    if (ticker.endsWith("PERP") && (identities[ticker.slice(0, -4)] || nonCrypto.has(ticker.slice(0, -4))))
        ticker = ticker.slice(0, -4);
    return nonCrypto.has(ticker) || /(?:STOCK|XSTOCK|ETF)$/.test(ticker) ||
        (ticker.endsWith("X") && nonCrypto.has(ticker.slice(0, -1))) ||
        financialIds.has(identities[ticker]);
}
export function isCryptoAsset(asset) {
    const ticker = canonicalAsset(String(asset ?? "").trim().toUpperCase()).asset;
    if (isNonCryptoAsset(ticker)) return false;
    const identity = aliases[ticker] ?? ticker;
    return verified.has(identity) || (identity.endsWith("PERP") && verified.has(identity.slice(0, -4)));
}
