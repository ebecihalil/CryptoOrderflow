// Owner-only trading on Bybit (USDT perpetuals, one-way mode) through Bybit's V5 API.
//
// Keys live ONLY in the server's environment (systemd drop-in), never in the database,
// a response or the browser:
//   BYBIT_API_KEY, BYBIT_API_SECRET   key with "Contract - Orders/Positions" permission,
//                                     NO withdraw permission, IP-restricted to this server
//   BYBIT_TESTNET=1                   use api-testnet.bybit.com (fake money) instead of live
//   TRADING_OWNER_EMAIL               the one site account allowed to trade
// Without all of these the trading routes report "disabled" and nothing is shown.
import express from "express";
import { createHmac } from "node:crypto";
import { readCookie, SESSION_COOKIE } from "./accountRoutes.js";

export function bybitConfig(env = process.env) {
  const key = env.BYBIT_API_KEY?.trim(), secret = env.BYBIT_API_SECRET?.trim(), owner = env.TRADING_OWNER_EMAIL?.trim().toLowerCase();
  if (!key || !secret || !owner) return null;
  const testnet = env.BYBIT_TESTNET === "1" || env.BYBIT_TESTNET === "true";
  return { key, secret, owner, testnet, base: testnet ? "https://api-testnet.bybit.com" : "https://api.bybit.com" };
}

/** V5 signature: HMAC-SHA256(secret, timestamp + apiKey + recvWindow + (query string | JSON body)). */
export const signBybit = ({ key, secret, timestamp, recvWindow, payload }) =>
  createHmac("sha256", secret).update(`${timestamp}${key}${recvWindow}${payload}`).digest("hex");

export class TradingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createBybitClient({ config, fetchImpl = fetch, now = Date.now, recvWindow = 5000 }) {
  async function call(method, path, params = {}, { signed = true } = {}) {
    const timestamp = String(now());
    let url = `${config.base}${path}`, body, payload;
    if (method === "GET") {
      payload = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();
      if (payload) url += `?${payload}`;
    } else {
      body = JSON.stringify(params); payload = body;
    }
    const headers = { "Content-Type": "application/json" };
    if (signed) Object.assign(headers, {
      "X-BAPI-API-KEY": config.key, "X-BAPI-TIMESTAMP": timestamp, "X-BAPI-RECV-WINDOW": String(recvWindow),
      "X-BAPI-SIGN": signBybit({ key: config.key, secret: config.secret, timestamp, recvWindow, payload }),
    });
    let response, data;
    try {
      response = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(10_000) });
      data = await response.json();
    } catch {
      throw new TradingError(502, "Bybit did not answer. Check your connection and try again.");
    }
    if (data?.retCode !== 0) throw Object.assign(new TradingError(400, `Bybit: ${data?.retMsg || `error ${response?.status}`}`), { code: data?.retCode });
    return data.result;
  }
  return { call };
}

const SYMBOL = /^[A-Z0-9]{2,30}$/;
const decimals = step => { const text = String(step); return text.includes(".") ? text.split(".")[1].replace(/0+$/, "").length : 0; };
/** Round to the exchange step (down for quantities, nearest for prices), as a string Bybit accepts. */
export function toStep(value, step, mode = "floor") {
  const n = Number(value), s = Number(step);
  if (!Number.isFinite(n) || !(s > 0)) return null;
  const units = mode === "floor" ? Math.floor(n / s + 1e-9) : Math.round(n / s);
  return (units * s).toFixed(decimals(step));
}
const positive = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };

export function createTradingService({ client, config }) {
  const instruments = new Map(); // symbol -> {at, info}
  async function instrument(symbol) {
    if (!SYMBOL.test(symbol)) throw new TradingError(400, "Unknown contract.");
    const cached = instruments.get(symbol);
    if (cached && Date.now() - cached.at < 3600_000) return cached.info;
    const result = await client.call("GET", "/v5/market/instruments-info", { category: "linear", symbol }, { signed: false });
    const row = result?.list?.[0];
    if (!row || row.status !== "Trading") throw new TradingError(404, `${symbol} is not trading on Bybit${config.testnet ? " testnet" : ""}.`);
    const info = { symbol, tickSize: row.priceFilter.tickSize, qtyStep: row.lotSizeFilter.qtyStep, minQty: row.lotSizeFilter.minOrderQty,
      maxQty: row.lotSizeFilter.maxOrderQty, minNotional: row.lotSizeFilter.minNotionalValue ?? null,
      maxLeverage: Number(row.leverageFilter.maxLeverage), leverageStep: row.leverageFilter.leverageStep, base: row.baseCoin };
    instruments.set(symbol, { at: Date.now(), info });
    return info;
  }

  async function market(symbol) {
    const info = await instrument(symbol);
    const [tickers, position] = await Promise.all([
      client.call("GET", "/v5/market/tickers", { category: "linear", symbol }, { signed: false }),
      client.call("GET", "/v5/position/list", { category: "linear", symbol }),
    ]);
    const t = tickers?.list?.[0] ?? {}, p = position?.list?.[0];
    return { ...info, bid: t.bid1Price ?? null, ask: t.ask1Price ?? null, last: t.lastPrice ?? null, mark: t.markPrice ?? null,
      leverage: p ? Number(p.leverage) : null };
  }

  async function account() {
    const [wallet, positions, orders] = await Promise.all([
      client.call("GET", "/v5/account/wallet-balance", { accountType: "UNIFIED" }),
      client.call("GET", "/v5/position/list", { category: "linear", settleCoin: "USDT" }),
      client.call("GET", "/v5/order/realtime", { category: "linear", settleCoin: "USDT", limit: 50 }),
    ]);
    const w = wallet?.list?.[0] ?? {};
    const usdt = (w.coin ?? []).find(coin => coin.coin === "USDT") ?? {};
    return {
      testnet: config.testnet,
      balance: { equity: w.totalEquity ?? null, marginBalance: w.totalMarginBalance ?? null, available: w.totalAvailableBalance ?? null,
        walletUsdt: usdt.walletBalance ?? null, unrealisedPnl: w.totalPerpUPL ?? null },
      positions: (positions?.list ?? []).filter(p => Number(p.size) > 0).map(p => ({
        symbol: p.symbol, side: p.side, size: p.size, entryPrice: p.avgPrice, markPrice: p.markPrice, liqPrice: p.liqPrice || null,
        leverage: p.leverage, positionValue: p.positionValue, unrealisedPnl: p.unrealisedPnl, realisedPnl: p.curRealisedPnl,
        takeProfit: Number(p.takeProfit) ? p.takeProfit : null, stopLoss: Number(p.stopLoss) ? p.stopLoss : null, positionIdx: p.positionIdx,
        margin: p.positionIM ?? p.positionBalance ?? null, createdTime: Number(p.createdTime) || null,
      })),
      orders: (orders?.list ?? []).map(o => ({
        orderId: o.orderId, symbol: o.symbol, side: o.side, orderType: o.orderType, price: Number(o.price) ? o.price : null,
        triggerPrice: Number(o.triggerPrice) ? o.triggerPrice : null, qty: o.qty, filled: o.cumExecQty, status: o.orderStatus,
        reduceOnly: !!o.reduceOnly, stopOrderType: o.stopOrderType || null, takeProfit: Number(o.takeProfit) ? o.takeProfit : null,
        stopLoss: Number(o.stopLoss) ? o.stopLoss : null, timeInForce: o.timeInForce, createdTime: Number(o.createdTime) || null,
      })),
    };
  }

  async function history() {
    const result = await client.call("GET", "/v5/order/history", { category: "linear", limit: 50 });
    return { orders: (result?.list ?? []).map(o => ({
      orderId: o.orderId, symbol: o.symbol, side: o.side, orderType: o.orderType, price: Number(o.avgPrice) ? o.avgPrice : Number(o.price) ? o.price : null,
      qty: o.qty, filled: o.cumExecQty, status: o.orderStatus, reduceOnly: !!o.reduceOnly, createdTime: Number(o.createdTime) || null,
      updatedTime: Number(o.updatedTime) || null,
    })) };
  }

  async function setLeverage(symbol, leverage) {
    const info = await instrument(symbol);
    const value = positive(leverage);
    if (!value || value > info.maxLeverage) throw new TradingError(400, `Leverage must be between 1 and ${info.maxLeverage}x.`);
    const text = toStep(value, info.leverageStep || "0.01", "round");
    try {
      await client.call("POST", "/v5/position/set-leverage", { category: "linear", symbol, buyLeverage: text, sellLeverage: text });
    } catch (error) {
      if (error.code !== 110043) throw error; // 110043: leverage not modified
    }
    return { leverage: Number(text) };
  }

  /**
   * input: {symbol, side: Buy|Sell, type: market|limit|stop|stopLimit, qty (coins), price?, triggerPrice?,
   *         leverage?, takeProfit?, stopLoss?, timeInForce?: GTC|IOC|FOK|PostOnly, reduceOnly?}
   */
  async function placeOrder(input = {}) {
    const symbol = String(input.symbol ?? "");
    const info = await instrument(symbol);
    const side = input.side === "Buy" || input.side === "Sell" ? input.side : null;
    const type = ["market", "limit", "stop", "stopLimit"].includes(input.type) ? input.type : null;
    if (!side || !type) throw new TradingError(400, "Choose Buy or Sell and an order type.");
    const qty = toStep(input.qty, info.qtyStep);
    if (!qty || Number(qty) < Number(info.minQty)) throw new TradingError(400, `Minimum amount is ${info.minQty} ${info.base}.`);
    if (Number(qty) > Number(info.maxQty)) throw new TradingError(400, `Maximum amount per order is ${info.maxQty} ${info.base}.`);
    const order = { category: "linear", symbol, side, qty, positionIdx: 0, orderType: type === "limit" || type === "stopLimit" ? "Limit" : "Market" };
    if (order.orderType === "Limit") {
      const price = toStep(input.price, info.tickSize, "round");
      if (!positive(price)) throw new TradingError(400, "Enter a limit price.");
      order.price = price;
      order.timeInForce = ["GTC", "IOC", "FOK", "PostOnly"].includes(input.timeInForce) ? input.timeInForce : "GTC";
    }
    if (type === "stop" || type === "stopLimit") {
      const trigger = toStep(input.triggerPrice, info.tickSize, "round");
      if (!positive(trigger)) throw new TradingError(400, "Enter a stop (trigger) price.");
      const tickers = await client.call("GET", "/v5/market/tickers", { category: "linear", symbol }, { signed: false });
      const last = Number(tickers?.list?.[0]?.lastPrice);
      order.triggerPrice = trigger;
      order.triggerDirection = Number(trigger) > last ? 1 : 2; // 1: rises to trigger, 2: falls to trigger
      order.triggerBy = "LastPrice";
    }
    if (input.reduceOnly) order.reduceOnly = true;
    const tp = input.takeProfit ? toStep(input.takeProfit, info.tickSize, "round") : null;
    const sl = input.stopLoss ? toStep(input.stopLoss, info.tickSize, "round") : null;
    if (tp && positive(tp)) order.takeProfit = tp;
    if (sl && positive(sl)) order.stopLoss = sl;
    if (order.takeProfit || order.stopLoss) Object.assign(order, { tpslMode: "Full", tpTriggerBy: "LastPrice", slTriggerBy: "LastPrice" });
    if (input.leverage !== undefined && input.leverage !== null && input.leverage !== "") await setLeverage(symbol, input.leverage);
    const result = await client.call("POST", "/v5/order/create", order);
    return { orderId: result?.orderId ?? null, sent: order };
  }

  async function cancelOrder({ symbol, orderId } = {}) {
    if (!SYMBOL.test(String(symbol)) || typeof orderId !== "string" || !/^[\w-]{1,64}$/.test(orderId)) throw new TradingError(400, "Unknown order.");
    await client.call("POST", "/v5/order/cancel", { category: "linear", symbol, orderId });
    return { ok: true };
  }
  async function cancelAll({ symbol } = {}) {
    const params = { category: "linear" };
    if (symbol) { if (!SYMBOL.test(String(symbol))) throw new TradingError(400, "Unknown contract."); params.symbol = symbol; }
    else params.settleCoin = "USDT";
    await client.call("POST", "/v5/order/cancel-all", params);
    return { ok: true };
  }

  /** Market-close (part of) an open position: reduce-only order on the opposite side. */
  async function closePosition({ symbol, qty, price } = {}) {
    const info = await instrument(String(symbol ?? ""));
    const positions = await client.call("GET", "/v5/position/list", { category: "linear", symbol: info.symbol });
    const position = (positions?.list ?? []).find(p => Number(p.size) > 0);
    if (!position) throw new TradingError(404, "No open position.");
    const size = Number(position.size), wanted = qty ? Math.min(Number(qty), size) : size;
    const amount = toStep(wanted, info.qtyStep);
    if (!positive(amount)) throw new TradingError(400, "Enter an amount to close.");
    const order = { category: "linear", symbol: info.symbol, side: position.side === "Buy" ? "Sell" : "Buy", qty: amount, reduceOnly: true,
      positionIdx: Number(position.positionIdx) || 0, orderType: "Market" };
    if (positive(price)) Object.assign(order, { orderType: "Limit", price: toStep(price, info.tickSize, "round"), timeInForce: "GTC" });
    const result = await client.call("POST", "/v5/order/create", order);
    return { orderId: result?.orderId ?? null };
  }

  /** Set or clear the position's take profit / stop loss ("" or 0 clears). */
  async function setTradingStop({ symbol, takeProfit, stopLoss } = {}) {
    const info = await instrument(String(symbol ?? ""));
    const body = { category: "linear", symbol: info.symbol, positionIdx: 0, tpslMode: "Full" };
    if (takeProfit !== undefined) body.takeProfit = positive(takeProfit) ? toStep(takeProfit, info.tickSize, "round") : "0";
    if (stopLoss !== undefined) body.stopLoss = positive(stopLoss) ? toStep(stopLoss, info.tickSize, "round") : "0";
    await client.call("POST", "/v5/position/trading-stop", body);
    return { ok: true };
  }

  return { instrument, market, account, history, setLeverage, placeOrder, cancelOrder, cancelAll, closePosition, setTradingStop };
}

/**
 * /api/trading/*: REAL trading, only the owner account (TRADING_OWNER_EMAIL) can see or use it.
 * /api/paper/*: paper trading (simulated money, live Bybit prices) for every signed-in user.
 */
export function createTradingRouter({ accounts, config = bybitConfig(), service = null, paper = null }) {
  const router = express.Router();
  const trading = config ? service ?? createTradingService({ client: createBybitClient({ config }), config }) : null;
  const userOf = req => accounts.userForToken(readCookie(req.headers.cookie, SESSION_COOKIE));
  const owner = req => {
    if (!config) return false;
    const user = userOf(req);
    return !!user && user.email.toLowerCase() === config.owner;
  };
  // Real trading is never mentioned to anyone but the owner.
  router.get("/trading/status", (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = userOf(req);
    res.json(owner(req) ? { enabled: true, exchange: "bybit", testnet: config.testnet, paper: !!paper }
      : { enabled: false, paper: !!paper && !!user });
  });
  const guarded = (allowed, handler) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (!allowed(req)) throw new TradingError(404, "Not found.");
      if (req.method !== "GET") {
        if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) throw new TradingError(403, "Requests must come from this site.");
        if (!req.is("application/json")) throw new TradingError(415, "JSON body required.");
      }
      res.json(await handler(req, userOf(req)));
    } catch (error) {
      const status = error instanceof TradingError ? error.status : 500;
      if (status === 500) console.error("Trading request failed", error?.message);
      res.status(status).json({ error: status === 500 ? "Trading request failed." : error.message });
    }
  };
  const route = handler => guarded(owner, handler);
  router.get("/trading/market", route(req => trading.market(String(req.query.symbol ?? ""))));
  router.get("/trading/account", route(() => trading.account()));
  router.get("/trading/history", route(() => trading.history()));
  router.post("/trading/order", route(req => trading.placeOrder(req.body)));
  router.post("/trading/cancel", route(req => trading.cancelOrder(req.body)));
  router.post("/trading/cancel-all", route(req => trading.cancelAll(req.body)));
  router.post("/trading/close", route(req => trading.closePosition(req.body)));
  router.post("/trading/leverage", route(req => trading.setLeverage(String(req.body?.symbol ?? ""), req.body?.leverage)));
  router.post("/trading/tpsl", route(req => trading.setTradingStop(req.body)));
  if (paper) {
    const signedIn = req => !!userOf(req);
    const p = handler => guarded(signedIn, handler);
    router.get("/paper/market", p((req, user) => paper.market(user.id, req.query)));
    router.get("/paper/account", p((_req, user) => paper.account(user.id)));
    router.get("/paper/history", p((_req, user) => paper.history(user.id)));
    router.post("/paper/order", p((req, user) => paper.placeOrder(user.id, req.body)));
    router.post("/paper/cancel", p((req, user) => paper.cancelOrder(user.id, req.body)));
    router.post("/paper/cancel-all", p((req, user) => paper.cancelAll(user.id, req.body)));
    router.post("/paper/close", p((req, user) => paper.closePosition(user.id, req.body)));
    router.post("/paper/settings", p((req, user) => paper.settings(user.id, req.body)));
    router.post("/paper/tpsl", p((req, user) => paper.setTradingStop(user.id, req.body)));
    router.post("/paper/reset", p((_req, user) => paper.reset(user.id)));
  }
  return router;
}
