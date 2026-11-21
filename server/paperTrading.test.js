import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createPaperTrading, createLiveQuotes, genericRules, liquidationPrice, PAPER_START_BALANCE } from "./paperTrading.js";
import { createTradingRouter } from "./bybitTrading.js";

function market(price) {
  const state = { last: price, bid: price, ask: price };
  return {
    state,
    quote: async (exchange, symbol) => symbol === "SKYUSDT" ? { last: state.last, mark: state.last, bid: state.bid, ask: state.ask } : null,
    instrument: async (exchange, symbol) => {
      if (symbol !== "SKYUSDT") throw Object.assign(new Error("not trading"), { status: 404 });
      return { symbol, exchange, tickSize: "0.0001", qtyStep: "1", minQty: "10", maxQty: "1000000", maxLeverage: 25, base: "SKY" };
    },
  };
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
  const fees = 1000 * 1 * 0.0005 + 1000 * 1.1 * 0.0005;
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

test("commission settings: fees off, custom fees, new starting balance resets", async () => {
  const data = market(1);
  const paper = createPaperTrading({ data, timers: false });
  paper.settings(7, { commission: false });
  await paper.placeOrder(7, { symbol: "SKYUSDT", side: "Buy", type: "market", qty: 1000 });
  await paper.closePosition(7, { symbol: "SKYUSDT" });
  assert.equal(Number((await paper.account(7)).balance.walletUsdt), PAPER_START_BALANCE);
  paper.settings(7, { commission: true, marketFeePct: 0.1 });
  await paper.placeOrder(7, { symbol: "SKYUSDT", side: "Buy", type: "market", qty: 1000 });
  assert.ok(Math.abs(Number((await paper.account(7)).balance.walletUsdt) - (PAPER_START_BALANCE - 1)) < 1e-9);
  paper.settings(7, { startBalance: 500 });
  const account = await paper.account(7);
  assert.equal(Number(account.balance.walletUsdt), 500);
  assert.equal(account.positions.length, 0);
  assert.equal(account.settings.marketFeePct, 0.1);
  assert.throws(() => paper.settings(7, { marketFeePct: 5 }), /between 0% and 1%/);
});

test("live quotes: the chart's exchange, else the coin's Bybit price; generic contract rules", async () => {
  const bodies = {
    "https://contract.mexc.com/api/v1/contract/ticker": { data: [{ symbol: "PARTI_USDT", lastPrice: 0.0378, bid1: 0.0377, ask1: 0.0379, fairPrice: 0.0378 }] },
    "https://api.bybit.com/v5/market/tickers?category=linear": { result: { list: [{ symbol: "PARTIUSDT", lastPrice: "0.0380", bid1Price: "0.0379", ask1Price: "0.0381", markPrice: "0.038" }] } },
  };
  const quotes = createLiveQuotes({ request: async url => bodies[url] ?? {} });
  assert.deepEqual(await quotes.quote("mexc", "PARTI_USDT", "PARTI"), { last: 0.0378, bid: 0.0377, ask: 0.0379, mark: 0.0378, source: "mexc" });
  assert.equal((await quotes.quote("kucoin", "PARTIUSDTM", "PARTI")).source, "bybit");
  assert.equal(await quotes.quote("kucoin", "NOPEUSDTM", "NOPE"), null);
  assert.deepEqual(genericRules(58000), { tickSize: "0.1", qtyStep: "0.00001", minQty: "0.00001", maxQty: "1000000000", maxLeverage: 100 });
  assert.equal(genericRules(0.0378).qtyStep, "10");
  assert.equal(genericRules(0.0378).tickSize, "0.0000001");
});
