import { fileURLToPath } from "node:url";
import { BinanceRequestGate } from "./binanceRequestGate.js";
import { EXCHANGE_POLICIES, ExchangeRequestGate } from "./exchangeRequestGate.js";
import { RequestStateStore } from "./requestStateStore.js";

export function createRequestGates({
    store = new RequestStateStore(fileURLToPath(new URL("../.cache/exchange-request-state.json", import.meta.url))),
} = {}) {
    const settings = exchange => ({ state: store.read(exchange), save: state => store.save(exchange, state) });
    return {
        // Binance published limits: 2,400 weight/min and 1,000 requests/5 min
        // per /futures/data endpoint, per IP. Hosting IPs may be shared with
        // other tenants, so this app uses at most ~17% / 45% of them, pauses
        // when the IP's reported weight reaches 25%, and probes with one
        // request after every restart or pause. See docs/exchange-request-limits.md.
        binance: new BinanceRequestGate({
            generalLimit: 400, historyLimit: 450, fundingLimit: 200, usedWeightPause: 600,
            spacingMs: 150, probe: true, ...settings("binance"),
        }),
        ...Object.fromEntries(Object.keys(EXCHANGE_POLICIES)
            .map(exchange => [exchange, new ExchangeRequestGate(exchange, settings(exchange))])),
    };
}
