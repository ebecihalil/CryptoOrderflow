import test from "node:test";
import assert from "node:assert/strict";
import { binanceAccessConfig, routeBinanceRequest, routeBinanceSocket, createGeoBlockRegistry, BinanceGeoBlockError } from "./binanceAccess.js";
import { createExchangeHttpClient } from "./exchangeHttpClient.js";

const direct = binanceAccessConfig({});
const relay = binanceAccessConfig({ BINANCE_RELAY_URL: "https://relay.example.com/", BINANCE_RELAY_KEY: "secret" });

test("spot public market data uses Binance's official binance.vision domains", () => {
  assert.equal(routeBinanceRequest("https://api.binance.com/api/v3/exchangeInfo", direct).url, "https://data-api.binance.vision/api/v3/exchangeInfo");
  assert.equal(routeBinanceSocket("wss://stream.binance.com:9443/ws", direct).url, "wss://data-stream.binance.vision/ws");
  const forced = binanceAccessConfig({ BINANCE_SPOT_HOST: "binance.com" });
  assert.equal(routeBinanceRequest("https://api.binance.com/api/v3/exchangeInfo", forced).url, "https://api.binance.com/api/v3/exchangeInfo");
});

test("futures stay direct without a relay and go through the relay when configured", () => {
  const url = "https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m";
  assert.deepEqual(routeBinanceRequest(url, direct), { url, headers: {} });
  assert.deepEqual(routeBinanceRequest(url, relay), {
    url: "https://relay.example.com/fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m",
    headers: { "x-relay-key": "secret" },
  });
  assert.equal(routeBinanceSocket("wss://fstream.binance.com/market/ws", relay).url, "wss://relay.example.com/fstream.binance.com/market/ws");
  // Spot keeps the keyless official mirror even when a relay exists.
  assert.equal(routeBinanceRequest("https://api.binance.com/api/v3/exchangeInfo", relay).url, "https://data-api.binance.vision/api/v3/exchangeInfo");
  assert.throws(() => binanceAccessConfig({ BINANCE_RELAY_URL: "ftp://x" }));
});

function client({ status = 200, body = {}, headers = {}, now = () => 1_000 } = {}) {
  const calls = [];
  const gate = { enter: async () => {}, inspect: async () => {}, checkCooldown() {} };
  const geoBlocks = createGeoBlockRegistry({ now });
  const fetchJson = createExchangeHttpClient({
    gates: { binance: gate }, geoBlocks, sleep: async () => {}, route: url => routeBinanceRequest(url, direct),
    fetchImpl: async url => { calls.push(url); return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers }); },
  });
  return { fetchJson, calls, geoBlocks };
}

test("HTTP 451 marks only that Binance host and later calls fail fast without network", async () => {
  const { fetchJson, calls, geoBlocks } = client({ status: 451, body: { msg: "Service unavailable from a restricted location" } });
  await assert.rejects(fetchJson("https://fapi.binance.com/fapi/v1/exchangeInfo"), BinanceGeoBlockError);
  await assert.rejects(fetchJson("https://fapi.binance.com/fapi/v1/ticker/price"), /restricted region/);
  assert.equal(calls.length, 1);
  geoBlocks.check("https://data-api.binance.vision/api/v3/exchangeInfo");
  assert.doesNotThrow(() => geoBlocks.check("https://api.binance.com/api/v3/exchangeInfo"));
});

test("a CloudFront country block 403 is treated as a geo block, not a ban", async () => {
  const { fetchJson } = client({ status: 403, body: "The Amazon CloudFront distribution is configured to block access from your country.",
    headers: { "x-cache": "Error from cloudfront" } });
  await assert.rejects(fetchJson("https://fapi.binance.com/fapi/v1/exchangeInfo"), BinanceGeoBlockError);
});
