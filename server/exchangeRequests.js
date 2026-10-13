import { createRequestGates } from "./requestGates.js";
import { createExchangeHttpClient } from "./exchangeHttpClient.js";

// One shared collector budget per exchange across EVERY order-flow module.
export const requestGates = createRequestGates();
export const requestJson = createExchangeHttpClient({ gates: requestGates });
