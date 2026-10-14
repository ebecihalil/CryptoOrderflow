import { BinanceCooldownError } from "./binanceRequestGate.js";
import { ExchangeCooldownError } from "./exchangeRequestGate.js";

const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
const HOSTS = {
    "api.binance.com": "binance", "api.kucoin.com": "kucoin",
    "api.kraken.com": "kraken", "api.huobi.pro": "htx",
    "fapi.binance.com": "binance", "dapi.binance.com": "binance",
    "api.bybit.com": "bybit", "api2.bybit.com": "bybit", "www.okx.com": "okx",
    "api.gateio.ws": "gate", "api.bitget.com": "bitget", "api.toobit.com": "toobit",
    "contract.mexc.com": "mexc", "api.mexc.com": "mexc", "api-futures.kucoin.com": "kucoin",
    "futures.kraken.com": "kraken", "open-api.bingx.com": "bingx",
    "api.hyperliquid.xyz": "hyperliquid", "api.hbdm.com": "htx",
    "www.deribit.com": "deribit", "fapi.asterdex.com": "aster",
    "api.coinex.com": "coinex", "www.bitmex.com": "bitmex",
    "mainnet.zklighter.elliot.ai": "lighter", "api.prod.paradex.trade": "paradex",
    "api.backpack.exchange": "backpack",
};
export const exchangeForUrl = value => HOSTS[new URL(value).hostname];
export const isExchangeCooldown = error => error instanceof BinanceCooldownError || error instanceof ExchangeCooldownError;

export function createExchangeHttpClient({ gates, fetchImpl = fetch, sleep = wait, timeoutMs = 12_000 }) {
    return async function fetchJson(url, options = {}) {
        const exchange = exchangeForUrl(url);
        const gate = gates[exchange];
        if (!gate) throw new Error("No request limiter configured for exchange URL");
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await gate.enter(url); // Includes retries; queued time is NOT network timeout time.
                const response = await fetchImpl(url, {
                    ...options,
                    signal: AbortSignal.timeout(timeoutMs),
                    headers: { "User-Agent": "Crypto-Orderflow/1.0", ...options.headers },
                });
                await gate.inspect(response);
                if (!response.ok) {
                    const error = new Error(`Exchange returned HTTP ${response.status}`);
                    error.retryable = response.status >= 500;
                    throw error;
                }
                const body = await response.json();
                await gate.inspectBody?.(body, response);
                const successCodes = exchange === "kucoin" ? ["200000"] : exchange === "lighter" ? ["200"] : ["0", "00000"];
                if (body.code !== undefined && !successCodes.includes(String(body.code)))
                    throw Object.assign(new Error(body.msg || `Exchange error ${body.code}`), { retryable: false });
                if (body.retCode !== undefined && String(body.retCode) !== "0")
                    throw Object.assign(new Error(body.retMsg || `Exchange error ${body.retCode}`), { retryable: String(body.retCode) === "10016" });
                if (body.success === false || body.result === "error" ||
                    (Array.isArray(body.error) ? body.error.length > 0 : body.error))
                    throw Object.assign(new Error(body.message || body.error?.message || String(body.error || "Exchange returned an error")), { retryable: false });
                return body;
            } catch (error) {
                lastError = error;
                if (isExchangeCooldown(error) || error?.retryable === false) break;
                if (!(error?.retryable === true || error?.name === "TimeoutError" || error instanceof TypeError)) break;
                if (attempt < 2) await sleep(1000 * 2 ** attempt);
            }
        }
        throw lastError instanceof Error ? lastError : new Error("Exchange request failed");
    };
}
