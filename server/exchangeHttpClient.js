import { BinanceCooldownError } from "./binanceRequestGate.js";
import { ExchangeCooldownError } from "./exchangeRequestGate.js";

const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
const HOSTS = {
    "fapi.binance.com": "binance", "dapi.binance.com": "binance",
    "api.bybit.com": "bybit", "www.okx.com": "okx",
    "api.gateio.ws": "gate", "api.bitget.com": "bitget", "api.toobit.com": "toobit",
};
export const exchangeForUrl = value => HOSTS[new URL(value).hostname];
export const isExchangeCooldown = error => error instanceof BinanceCooldownError || error instanceof ExchangeCooldownError;

export function createExchangeHttpClient({ gates, fetchImpl = fetch, sleep = wait, timeoutMs = 12_000 }) {
    return async function fetchJson(url) {
        const gate = gates[exchangeForUrl(url)];
        if (!gate) throw new Error("No request limiter configured for exchange URL");
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await gate.enter(url); // Includes retries; queued time is NOT network timeout time.
                const response = await fetchImpl(url, {
                    signal: AbortSignal.timeout(timeoutMs),
                    headers: { "User-Agent": "Perpetual-LSAR-Screener/1.0" },
                });
                await gate.inspect(response);
                if (!response.ok) {
                    const error = new Error(`Exchange returned HTTP ${response.status}`);
                    error.retryable = response.status >= 500;
                    throw error;
                }
                const body = await response.json();
                await gate.inspectBody?.(body, response);
                if (body.code !== undefined && !["0", "00000"].includes(String(body.code)))
                    throw Object.assign(new Error(body.msg || `Exchange error ${body.code}`), { retryable: false });
                if (body.retCode !== undefined && String(body.retCode) !== "0")
                    throw Object.assign(new Error(body.retMsg || `Exchange error ${body.retCode}`), { retryable: String(body.retCode) === "10016" });
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
