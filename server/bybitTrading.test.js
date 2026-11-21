import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import express from "express";
import { bybitConfig, signBybit, toStep, createBybitClient, createTradingService, createTradingRouter } from "./bybitTrading.js";

const config = { key: "KEY", secret: "SECRET", owner: "me@example.com", testnet: true, base: "https://api-testnet.bybit.com" };

test("config needs key, secret and owner; testnet switch", () => {
  assert.equal(bybitConfig({}), null);
  assert.equal(bybitConfig({ BYBIT_API_KEY: "a", BYBIT_API_SECRET: "b" }), null);
  const c = bybitConfig({ BYBIT_API_KEY: "a", BYBIT_API_SECRET: "b", TRADING_OWNER_EMAIL: "Me@Example.com", BYBIT_TESTNET: "1" });
  assert.equal(c.owner, "me@example.com");
  assert.equal(c.base, "https://api-testnet.bybit.com");
  assert.equal(bybitConfig({ BYBIT_API_KEY: "a", BYBIT_API_SECRET: "b", TRADING_OWNER_EMAIL: "x" }).base, "https://api.bybit.com");
});

test("V5 signature and signed GET / POST requests", async () => {
  const expected = createHmac("sha256", "SECRET").update("1700000000000KEY5000category=linear").digest("hex");
  assert.equal(signBybit({ key: "KEY", secret: "SECRET", timestamp: "1700000000000", recvWindow: 5000, payload: "category=linear" }), expected);
  const calls = [];
  const client = createBybitClient({ config, now: () => 1700000000000,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { json: async () => ({ retCode: 0, result: { ok: 1 } }) }; } });
  await client.call("GET", "/v5/position/list", { category: "linear", symbol: "BTCUSDT" });
  assert.equal(calls[0].url, "https://api-testnet.bybit.com/v5/position/list?category=linear&symbol=BTCUSDT");
  assert.equal(calls[0].init.headers["X-BAPI-SIGN"],
    signBybit({ key: "KEY", secret: "SECRET", timestamp: "1700000000000", recvWindow: 5000, payload: "category=linear&symbol=BTCUSDT" }));
  await client.call("POST", "/v5/order/create", { a: 1 });
  assert.equal(calls[1].init.body, '{"a":1}');
  assert.equal(calls[1].init.headers["X-BAPI-SIGN"], signBybit({ key: "KEY", secret: "SECRET", timestamp: "1700000000000", recvWindow: 5000, payload: '{"a":1}' }));
  const failing = createBybitClient({ config, fetchImpl: async () => ({ json: async () => ({ retCode: 10001, retMsg: "Qty invalid" }) }) });
  await assert.rejects(failing.call("GET", "/x"), /Bybit: Qty invalid/);
});

test("amounts round down to the lot step, prices to the tick", () => {
  assert.equal(toStep(1234.567, "1"), "1234");
  assert.equal(toStep(0.0129, "0.001"), "0.012");
  assert.equal(toStep(0.035327, "0.00001", "round"), "0.03533");
  assert.equal(toStep("abc", "1"), null);
});

function fakeClient(extra = {}) {
  const sent = [];
  const client = { sent, async call(method, path, params) {
    sent.push({ method, path, params });
    if (path === "/v5/market/instruments-info") return { list: [{ status: "Trading", priceFilter: { tickSize: "0.00001" },
      lotSizeFilter: { qtyStep: "1", minOrderQty: "10", maxOrderQty: "1000000" }, leverageFilter: { maxLeverage: "25", leverageStep: "0.01" }, baseCoin: "SKY" }] };
    if (path === "/v5/market/tickers") return { list: [{ lastPrice: "0.0353", bid1Price: "0.03527", ask1Price: "0.03529" }] };
    if (path === "/v5/position/list") return extra.positions ?? { list: [] };
    return extra[path] ?? {};
  } };
  return client;
}

test("limit order with leverage, TP/SL and rounding", async () => {
  const client = fakeClient({ "/v5/order/create": { orderId: "abc" } });
  const service = createTradingService({ client, config });
  const result = await service.placeOrder({ symbol: "SKYUSDT", side: "Buy", type: "limit", qty: 1000.7, price: 0.035321,
    leverage: 10, takeProfit: 0.03783, stopLoss: 0.03401, timeInForce: "GTC" });
  assert.equal(result.orderId, "abc");
  const leverage = client.sent.find(call => call.path === "/v5/position/set-leverage");
  assert.equal(leverage.params.buyLeverage, "10.00");
  const order = client.sent.find(call => call.path === "/v5/order/create").params;
  assert.deepEqual(order, { category: "linear", symbol: "SKYUSDT", side: "Buy", qty: "1000", positionIdx: 0, orderType: "Limit",
    price: "0.03532", timeInForce: "GTC", takeProfit: "0.03783", stopLoss: "0.03401", tpslMode: "Full", tpTriggerBy: "LastPrice", slTriggerBy: "LastPrice" });
});

test("stop orders get the trigger direction from the last price; minimum amount is enforced", async () => {
  const client = fakeClient();
  const service = createTradingService({ client, config });
  await service.placeOrder({ symbol: "SKYUSDT", side: "Buy", type: "stop", qty: 100, triggerPrice: 0.036 });
  const order = client.sent.find(call => call.path === "/v5/order/create").params;
  assert.equal(order.orderType, "Market");
  assert.equal(order.triggerPrice, "0.03600");
  assert.equal(order.triggerDirection, 1);
  await assert.rejects(service.placeOrder({ symbol: "SKYUSDT", side: "Sell", type: "market", qty: 5 }), /Minimum amount is 10 SKY/);
  await assert.rejects(service.placeOrder({ symbol: "SKYUSDT", side: "Hold", type: "market", qty: 50 }), /Buy or Sell/);
});

test("close position sends a reduce-only market order on the other side", async () => {
  const client = fakeClient({ positions: { list: [{ symbol: "SKYUSDT", side: "Buy", size: "500", positionIdx: 0 }] } });
  const service = createTradingService({ client, config });
  await service.closePosition({ symbol: "SKYUSDT" });
  const order = client.sent.find(call => call.path === "/v5/order/create").params;
  assert.deepEqual(order, { category: "linear", symbol: "SKYUSDT", side: "Sell", qty: "500", reduceOnly: true, positionIdx: 0, orderType: "Market" });
});

test("router: only the owner sees or uses trading; mutations need this site's origin", async () => {
  const accounts = { userForToken: token => token === "owner-token-xxxxxxxxxxxx" ? { id: 1, email: "Me@Example.com" }
    : token === "other-token-xxxxxxxxxxxx" ? { id: 2, email: "other@example.com" } : null };
  const service = { account: async () => ({ positions: [] }), placeOrder: async body => ({ orderId: "1", body }) };
  const app = express(); app.use(express.json()); app.use("/api", createTradingRouter({ accounts, config, service }));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const get = (path, cookie) => fetch(base + path, { headers: cookie ? { cookie: `cof_session=${cookie}` } : {} });
    assert.deepEqual(await (await get("/api/trading/status")).json(), { enabled: false, paper: false });
    assert.deepEqual(await (await get("/api/trading/status", "other-token-xxxxxxxxxxxx")).json(), { enabled: false, paper: false });
    assert.equal((await get("/api/trading/account", "other-token-xxxxxxxxxxxx")).status, 404);
    assert.deepEqual(await (await get("/api/trading/status", "owner-token-xxxxxxxxxxxx")).json(), { enabled: true, exchange: "bybit", testnet: true, paper: false });
    assert.equal((await get("/api/trading/account", "owner-token-xxxxxxxxxxxx")).status, 200);
    const post = (headers) => fetch(base + "/api/trading/order", { method: "POST", body: JSON.stringify({ symbol: "X" }),
      headers: { "content-type": "application/json", cookie: "cof_session=owner-token-xxxxxxxxxxxx", ...headers } });
    assert.equal((await post({})).status, 403);
    assert.equal((await post({ origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ origin: base })).status, 200);
  } finally { server.close(); }
});
