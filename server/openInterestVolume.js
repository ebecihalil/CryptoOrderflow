import { requestJson, requestGates } from "./exchangeRequests.js";
import { number } from "./fundingMath.js";

const cache = new Map();
export function volumeSupplement(exchange, now = Date.now()) {
    if (!["binance", "okx", "gate", "bingx", "aster", "htx"].includes(exchange)) return null;
    if (!cache.has(exchange)) cache.set(exchange, { lastAttempt: 0, running: false, quotes: new Map() });
    const state = cache.get(exchange);
    if (!state.running && now - state.lastAttempt >= 300_000 && !requestGates[exchange].isCoolingDown) {
        state.lastAttempt = now; state.running = true;
        fetchQuotes(exchange).then(quotes => { state.quotes = quotes; state.updatedAt = Date.now(); })
            .catch(() => { /* Missing volume stays unavailable; never replace it with zero. */ })
            .finally(() => { state.running = false; });
    }
    return state.updatedAt && now - state.updatedAt <= 900_000 ? state.quotes : null;
}
async function fetchQuotes(exchange) {
    const quotes = new Map();
    if (exchange === "binance") {
        for (const market of ["fapi", "dapi"]) {
            const data = await requestJson(`https://${market}.binance.com/${market}/v1/ticker/24hr`);
            if (!Array.isArray(data)) throw new Error("Invalid Binance volume response");
            for (const item of data) quotes.set(item.symbol, { volume24hUsd: market === "fapi" ? number(item.quoteVolume) : null });
        }
    } else if (exchange === "okx") {
        const body = await requestJson("https://www.okx.com/api/v5/market/tickers?instType=SWAP");
        if (!Array.isArray(body.data)) throw new Error("Invalid OKX volume response");
        for (const item of body.data) quotes.set(item.instId, { markPrice: number(item.last),
            volume24hUsd: number(item.volCcy24h) !== null && number(item.last) > 0 ? number(item.volCcy24h) * number(item.last) : null });
    } else if (exchange === "gate") {
        const data = await requestJson("https://api.gateio.ws/api/v4/futures/usdt/tickers");
        if (!Array.isArray(data)) throw new Error("Invalid Gate volume response");
        for (const item of data) quotes.set(item.contract, { volume24hUsd: number(item.volume_24h_quote) });
    } else if (exchange === "bingx") {
        const body = await requestJson("https://open-api.bingx.com/openApi/swap/v2/quote/ticker");
        if (!Array.isArray(body.data)) throw new Error("Invalid BingX volume response");
        for (const item of body.data) quotes.set(item.symbol, { volume24hUsd: number(item.quoteVolume) });
    } else if (exchange === "htx") {
        const body = await requestJson("https://api.hbdm.com/linear-swap-ex/market/detail/batch_merged");
        const data = body.ticks ?? body.data;
        if (!Array.isArray(data)) throw new Error("Invalid HTX ticker response");
        for (const item of data) quotes.set(item.contract_code, { markPrice: number(item.close),
            volume24hUsd: number(item.trade_turnover) ?? (number(item.amount) !== null && number(item.close) > 0 ? number(item.amount) * number(item.close) : null) });
    } else {
        const data = await requestJson("https://fapi.asterdex.com/fapi/v1/ticker/24hr");
        if (!Array.isArray(data)) throw new Error("Invalid Aster volume response");
        for (const item of data) quotes.set(item.symbol, { volume24hUsd: number(item.quoteVolume) });
    }
    return quotes;
}
