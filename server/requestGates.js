import { fileURLToPath } from "node:url";
import { BinanceRequestGate } from "./binanceRequestGate.js";
import { EXCHANGE_POLICIES, ExchangeRequestGate } from "./exchangeRequestGate.js";
import { RequestStateStore } from "./requestStateStore.js";

export function createRequestGates({
    store = new RequestStateStore(fileURLToPath(new URL("../.cache/exchange-request-state.json", import.meta.url))),
} = {}) {
    const settings = exchange => ({ state: store.read(exchange), save: state => store.save(exchange, state) });
    return {
        binance: new BinanceRequestGate({ historyLimit: 800, spacingMs: 100, ...settings("binance") }),
        ...Object.fromEntries(Object.keys(EXCHANGE_POLICIES)
            .map(exchange => [exchange, new ExchangeRequestGate(exchange, settings(exchange))])),
    };
}
