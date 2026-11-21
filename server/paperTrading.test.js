import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createPaperTrading, liquidationPrice, PAPER_START_BALANCE } from "./paperTrading.js";
import { createTradingRouter } from "./bybitTrading.js";

function market(price) {
  const state = { last: price, bid: price, ask: price };
  const data = {
    state,
    allTickers: async () => new Map([["SKYUSDT", { lastPrice: String(state.last), markPrice: String(state.last), bid1Price: String(state.bid), ask1Price: String(state.ask) }]]),
    instrument: async symbol => {
      if (symbol !== "SKYUSDT") throw Object.assign(new Error("not trading"), { status: 404 });
      return { symbol, tickSize: "0.0001", qtyStep: "1", minQty: "10", maxQty: "1000000", maxLeverage: 25, base: "SKY" };
    },
  };
  return data;
}
const move = (data, price) => Object.assign(data.state, { last: price, bid: price, ask: price });

test("market buy opens a long; PnL follows the price; closing realises it minus fees", async () => {
  const data = market(1);
  const paper = createPaperTrading({ data, timers: false });
  await paper.placeOrder(1, { symbol: "SKYUSDT", side: "Buy", type: "market", qty: 1000, leverage: 10 });
  let account = await paper.account(1);
  assert.equal(account.positions[0].side, "Buy");
  assert.equal(account.positions[0].size, "1000");
  assert.equal(account.positions[0].margin, "100");
  move(data, 1.1);
  account = await paper.account(1);
  assert.equal(Number(account.positions[0].unrealisedPnl), 100);
  await paper.closePosition(1, { symbol: "SKYUSDT" });
  account = await paper.account(1);
  assert.equal(account.positions.length, 0);
  const fees = 1000 * 1 * 0.00055 + 1000 * 1.1 * 0.00055;
  assert.ok(Math.abs(Number(account.balance.walletUsdt) - (PAPER_START_BALANCE + 100 - fees)) < 1e-6);
  assert.equal((await paper.history(1)).orders.length, 2);
});

test("limit and stop orders wait, then fill when the price gets there", async () => {
  const data = market(1);
  const paper = createPaperTrading({ data, timers: false });
  await paper.placeOrder(2, { symbol: "SKYUSDT", side: "Buy", type: "limit", qty: 100, price: 0.9 });
  await paper.placeOrder(2, { symbol: "SKYUSDT", side: "Buy", type: "stop", qty: 100, triggerPrice: 1.2 });
  assert.equal((await paper.account(2)).orders.length, 2);
  move(data, 0.89); await paper.tick();
  let account = await paper.account(2);
  assert.equal(account.orders.length, 1);
  assert.equal(account.positions[0].entryPrice, "0.9");
  move(data, 1.25); await paper.tick();
  account = await paper.account(2);
  assert.equal(account.orders.length, 0);
  assert.equal(account.positions[0].size, "200");
});

test("TP / SL close the position; liquidation takes the margin; margin is checked", async () => {
  const data = market(1);
  const paper = createPaperTrading({ data, timers: false });
  await paper.placeOrder(3, { symbol: "SKYUSDT", side: "Sell", type: "market", qty: 1000, leverage: 5, stopLoss: 1.05 });
  move(data, 1.06); await paper.tick();
  assert.equal((await paper.account(3)).positions.length, 0);
  assert.equal((await paper.history(3)).orders[0].stopOrderType, "StopLoss");

  await paper.placeOrder(4, { symbol: "SKYUSDT", side: "Buy", type: "market", qty: 10000, leverage: 10 });
  const liq = liquidationPrice({ side: "Buy", entry: 1, leverage: 10 });
  assert.ok(Math.abs(liq - 0.905) < 1e-9);
  move(data, 0.9); await paper.tick();
  const account = await paper.account(4);
  assert.equal(account.positions.length, 0);
  assert.equal((await paper.history(4)).orders[0].status, "Liquidated");
  assert.ok(Number(account.balance.walletUsdt) < PAPER_START_BALANCE - 900);

  move(data, 1);
  await assert.rejects(paper.placeOrder(5, { symbol: "SKYUSDT", side: "Buy", type: "market", qty: 1_000_000, leverage: 1 }), /Not enough available balance/);
  await assert.rejects(paper.placeOrder(5, { symbol: "SKYUSDT", side: "Buy", type: "market", qty: 5 }), /Minimum amount/);
  paper.reset(4);
  assert.equal(Number((await paper.account(4)).balance.walletUsdt), PAPER_START_BALANCE);
});

test("paper routes: any signed-in user, each with their own account; never the real routes", async () => {
  const accounts = { userForToken: token => token === "user-a-token-xxxxxxxxxxx" ? { id: 10, email: "a@example.com" }
    : token === "user-b-token-xxxxxxxxxxx" ? { id: 11, email: "b@example.com" } : null };
  const data = market(1);
  const paper = createPaperTrading({ data, timers: false });
  const app = express(); app.use(express.json());
  app.use("/api", createTradingRouter({ accounts, config: null, paper }));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const call = (path, token, body) => fetch(base + path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined,
      headers: { ...(token ? { cookie: `cof_session=${token}` } : {}), ...(body ? { "content-type": "application/json", origin: base } : {}) } });
    assert.deepEqual(await (await call("/api/trading/status")).json(), { enabled: false, paper: false });
    assert.deepEqual(await (await call("/api/trading/status", "user-a-token-xxxxxxxxxxx")).json(), { enabled: false, paper: true });
    assert.equal((await call("/api/paper/account")).status, 404);
    assert.equal((await call("/api/trading/account", "user-a-token-xxxxxxxxxxx")).status, 404);
    assert.equal((await call("/api/paper/order", "user-a-token-xxxxxxxxxxx", { symbol: "SKYUSDT", side: "Buy", type: "market", qty: 100 })).status, 200);
    assert.equal((await (await call("/api/paper/account", "user-a-token-xxxxxxxxxxx")).json()).positions.length, 1);
    assert.equal((await (await call("/api/paper/account", "user-b-token-xxxxxxxxxxx")).json()).positions.length, 0);
  } finally { server.close(); }
});
