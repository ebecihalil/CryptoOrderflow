// Paper trading for every signed-in user: a simulated USDT-perpetual account per user,
// priced and matched against LIVE Bybit market data (public endpoints, no keys).
// Same request/response shapes as the real Bybit routes, so the UI is shared.
//
// Model (simplified Bybit one-way, cross margin):
// - wallet: USDT; each position {side, size, entry, leverage, tp, sl}; margin = size*entry/leverage
// - equity = wallet + unrealised PnL; available = equity - position margin - open-order margin
// - fills: market at bid/ask (taker fee 0.055%), limit when the last price reaches it (maker 0.02%),
//   stop / stop-limit trigger on the last price, TP/SL close at market, liquidation when the mark
//   crosses entry * (1 ∓ 1/leverage ± 0.5%) (isolated-style: the position's margin is lost)
// Accounts are saved as JSON per user in .cache/paper/ and checked every 2 s while anything is open.
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { TradingError, toStep } from "./bybitTrading.js";

export const PAPER_START_BALANCE = 10_000;
const TAKER = 0.00055, MAKER = 0.0002, MMR = 0.005;
const SYMBOL = /^[A-Z0-9]{2,30}$/;
const num = value => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const positive = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
const round = (value, digits = 8) => Math.round(value * 10 ** digits) / 10 ** digits;

export function liquidationPrice(position) {
  const dir = position.side === "Buy" ? 1 : -1;
  return position.entry * (1 - dir / position.leverage + dir * MMR);
}

/** Public Bybit data (shared by all users): tickers cached ~1.5 s, instruments 1 h. */
export function createBybitPublicData({ fetchImpl = fetch, base = "https://api.bybit.com", now = Date.now } = {}) {
  let tickers = { at: 0, map: new Map(), pending: null };
  const instruments = new Map();
  const get = async path => {
    const response = await fetchImpl(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
    const data = await response.json();
    if (data?.retCode !== 0) throw new TradingError(502, `Bybit: ${data?.retMsg ?? "no data"}`);
    return data.result;
  };
  async function allTickers() {
    if (now() - tickers.at < 1500) return tickers.map;
    if (!tickers.pending) tickers.pending = get("/v5/market/tickers?category=linear").then(result => {
      tickers = { at: now(), map: new Map((result?.list ?? []).map(row => [row.symbol, row])), pending: null };
      return tickers.map;
    }).catch(error => { tickers.pending = null; throw error; });
    return tickers.pending;
  }
  async function instrument(symbol) {
    if (!SYMBOL.test(symbol)) throw new TradingError(400, "Unknown contract.");
    const cached = instruments.get(symbol);
    if (cached && now() - cached.at < 3600_000) return cached.info;
    const result = await get(`/v5/market/instruments-info?category=linear&symbol=${symbol}`);
    const row = result?.list?.[0];
    if (!row || row.status !== "Trading") throw new TradingError(404, `${symbol} is not trading on Bybit.`);
    const info = { symbol, tickSize: row.priceFilter.tickSize, qtyStep: row.lotSizeFilter.qtyStep, minQty: row.lotSizeFilter.minOrderQty,
      maxQty: row.lotSizeFilter.maxOrderQty, maxLeverage: Number(row.leverageFilter.maxLeverage), base: row.baseCoin };
    instruments.set(symbol, { at: now(), info });
    return info;
  }
  return { allTickers, instrument };
}

export function createPaperTrading({ data = createBybitPublicData(), directory = null, now = Date.now, timers = true } = {}) {
  const accounts = new Map(); // userId -> account
  const dirty = new Set();
  const fresh = () => ({ wallet: PAPER_START_BALANCE, positions: {}, orders: [], history: [], leverage: {}, createdAt: now() });
  const file = userId => join(directory, `${userId}.json`);
  function load(userId) {
    if (accounts.has(userId)) return accounts.get(userId);
    let account = fresh();
    if (directory) { try { account = { ...fresh(), ...JSON.parse(readFileSync(file(userId), "utf8")) }; } catch { /* new account */ } }
    accounts.set(userId, account);
    return account;
  }
  function save(userId) { dirty.add(userId); }
  function flush() {
    if (!directory) { dirty.clear(); return; }
    try { mkdirSync(directory, { recursive: true }); } catch { return; }
    for (const userId of dirty) {
      try { writeFileSync(`${file(userId)}.tmp`, JSON.stringify(accounts.get(userId))); renameSync(`${file(userId)}.tmp`, file(userId)); } catch { /* retry next flush */ }
    }
    dirty.clear();
  }
  // Watch accounts with open orders/positions even when their owner is offline.
  if (directory) {
    try { for (const name of readdirSync(directory)) if (/^\d+\.json$/.test(name)) load(Number(name.slice(0, -5))); } catch { /* none yet */ }
  }

  const historyEntry = (fields) => ({ orderId: randomUUID(), createdTime: now(), updatedTime: now(), reduceOnly: false, ...fields });
  const record = (account, entry) => { account.history.unshift(entry); account.history.length = Math.min(account.history.length, 200); };

  /** Fill qty at price on the account; returns realised PnL. */
  function fill(account, { symbol, side, qty, price, fee, leverage, reduceOnly, takeProfit, stopLoss }) {
    let position = account.positions[symbol];
    let realised = 0;
    account.wallet -= qty * price * fee;
    if (position && position.side !== side) {
      const closing = Math.min(qty, position.size), dir = position.side === "Buy" ? 1 : -1;
      realised = (price - position.entry) * closing * dir;
      account.wallet += realised;
      position.size = round(position.size - closing);
      position.realised = (position.realised ?? 0) + realised;
      qty = round(qty - closing);
      if (position.size <= 0) { delete account.positions[symbol]; position = null; }
      if (reduceOnly) qty = 0;
    }
    if (qty > 0 && !reduceOnly) {
      if (position) {
        position.entry = (position.entry * position.size + price * qty) / (position.size + qty);
        position.size = round(position.size + qty);
      } else {
        position = account.positions[symbol] = { symbol, side, size: qty, entry: price, leverage: leverage ?? account.leverage[symbol] ?? 10,
          takeProfit: null, stopLoss: null, realised: 0, createdTime: now() };
      }
      if (takeProfit) position.takeProfit = takeProfit;
      if (stopLoss) position.stopLoss = stopLoss;
    }
    return realised;
  }

  function marks(tickers, symbol) {
    const t = tickers.get(symbol);
    return t ? { last: num(t.lastPrice), mark: num(t.markPrice) ?? num(t.lastPrice), bid: num(t.bid1Price) ?? num(t.lastPrice), ask: num(t.ask1Price) ?? num(t.lastPrice) } : null;
  }
  function summary(account, tickers) {
    let unrealised = 0, margin = 0;
    for (const p of Object.values(account.positions)) {
      const m = marks(tickers, p.symbol)?.mark ?? p.entry;
      unrealised += (m - p.entry) * p.size * (p.side === "Buy" ? 1 : -1);
      margin += p.size * p.entry / p.leverage;
    }
    const orderMargin = account.orders.filter(o => !o.reduceOnly).reduce((sum, o) => sum + o.qty * (o.price ?? o.triggerPrice ?? 0) / o.leverage, 0);
    const equity = account.wallet + unrealised;
    return { unrealised, margin, orderMargin, equity, available: Math.max(0, equity - margin - orderMargin) };
  }

  /** Run the matching engine for one account against current tickers. */
  function match(account, tickers) {
    let changed = false;
    for (const order of [...account.orders]) {
      const m = marks(tickers, order.symbol);
      if (!m?.last) continue;
      if (order.triggerPrice && !order.triggered) {
        const hit = order.triggerDirection === 1 ? m.last >= order.triggerPrice : m.last <= order.triggerPrice;
        if (!hit) continue;
        order.triggered = true; changed = true;
        if (order.orderType === "Market") {
          const price = order.side === "Buy" ? m.ask : m.bid;
          const realised = fill(account, { ...order, price, fee: TAKER });
          account.orders = account.orders.filter(o => o !== order);
          record(account, historyEntry({ ...publicOrder(order), price: String(price), filled: String(order.qty), status: "Filled", realised }));
          continue;
        }
      }
      if (order.orderType === "Limit" && (!order.triggerPrice || order.triggered)) {
        const reached = order.side === "Buy" ? m.last <= order.price : m.last >= order.price;
        if (!reached) continue;
        const realised = fill(account, { ...order, price: order.price, fee: MAKER });
        account.orders = account.orders.filter(o => o !== order);
        record(account, historyEntry({ ...publicOrder(order), price: String(order.price), filled: String(order.qty), status: "Filled", realised }));
        changed = true;
      }
    }
    for (const position of Object.values(account.positions)) {
      const m = marks(tickers, position.symbol);
      if (!m?.last) continue;
      const long = position.side === "Buy", closeSide = long ? "Sell" : "Buy";
      const liq = liquidationPrice(position);
      let reason = null, price = null;
      if (long ? m.mark <= liq : m.mark >= liq) { reason = "Liquidated"; price = liq; }
      else if (position.takeProfit && (long ? m.last >= position.takeProfit : m.last <= position.takeProfit)) { reason = "TakeProfit"; price = long ? m.bid : m.ask; }
      else if (position.stopLoss && (long ? m.last <= position.stopLoss : m.last >= position.stopLoss)) { reason = "StopLoss"; price = long ? m.bid : m.ask; }
      if (!reason) continue;
      const qty = position.size;
      const realised = fill(account, { symbol: position.symbol, side: closeSide, qty, price, fee: TAKER, reduceOnly: true });
      account.orders = account.orders.filter(o => !(o.symbol === position.symbol && o.reduceOnly));
      record(account, historyEntry({ symbol: position.symbol, side: closeSide, orderType: "Market", stopOrderType: reason, qty: String(qty),
        price: String(price), filled: String(qty), status: reason === "Liquidated" ? "Liquidated" : "Filled", reduceOnly: true, realised }));
      changed = true;
    }
    if (account.wallet < 0) account.wallet = 0;
    return changed;
  }

  const publicOrder = o => ({ orderId: o.orderId, symbol: o.symbol, side: o.side, orderType: o.orderType, price: o.price ? String(o.price) : null,
    triggerPrice: o.triggerPrice ? String(o.triggerPrice) : null, qty: String(o.qty), filled: "0", status: o.triggerPrice && !o.triggered ? "Untriggered" : "New",
    reduceOnly: !!o.reduceOnly, stopOrderType: o.triggerPrice ? "Stop" : null, takeProfit: o.takeProfit ? String(o.takeProfit) : null,
    stopLoss: o.stopLoss ? String(o.stopLoss) : null, timeInForce: o.timeInForce ?? null, createdTime: o.createdTime });

  async function tick() {
    const active = [...accounts].filter(([, account]) => account.orders.length || Object.keys(account.positions).length);
    if (!active.length) return;
    let tickers;
    try { tickers = await data.allTickers(); } catch { return; }
    for (const [userId, account] of active) if (match(account, tickers)) save(userId);
    flush();
  }
  let timer = null;
  if (timers) { timer = setInterval(() => { tick().catch(() => {}); }, 2000); timer.unref?.(); }

  async function withAccount(userId) {
    const account = load(userId);
    const tickers = await data.allTickers();
    if (match(account, tickers)) { save(userId); flush(); }
    return { account, tickers };
  }

  return {
    tick,
    stop: () => { if (timer) clearInterval(timer); timer = null; flush(); },
    async market(userId, symbol) {
      const info = await data.instrument(symbol);
      const { account, tickers } = await withAccount(userId);
      const t = tickers.get(symbol) ?? {};
      return { ...info, bid: t.bid1Price ?? null, ask: t.ask1Price ?? null, last: t.lastPrice ?? null, mark: t.markPrice ?? null,
        leverage: account.positions[symbol]?.leverage ?? account.leverage[symbol] ?? 10 };
    },
    async account(userId) {
      const { account, tickers } = await withAccount(userId);
      const s = summary(account, tickers);
      return {
        testnet: false, paper: true, startBalance: PAPER_START_BALANCE,
        balance: { equity: String(round(s.equity, 4)), marginBalance: String(round(s.equity, 4)), available: String(round(s.available, 4)),
          walletUsdt: String(round(account.wallet, 4)), unrealisedPnl: String(round(s.unrealised, 4)) },
        positions: Object.values(account.positions).map(p => {
          const m = marks(tickers, p.symbol)?.mark ?? p.entry, dir = p.side === "Buy" ? 1 : -1;
          return { symbol: p.symbol, side: p.side, size: String(p.size), entryPrice: String(round(p.entry)), markPrice: String(m),
            liqPrice: String(round(liquidationPrice(p))), leverage: String(p.leverage), positionValue: String(round(p.size * m, 4)),
            unrealisedPnl: String(round((m - p.entry) * p.size * dir, 4)), realisedPnl: String(round(p.realised ?? 0, 4)),
            takeProfit: p.takeProfit ? String(p.takeProfit) : null, stopLoss: p.stopLoss ? String(p.stopLoss) : null,
            margin: String(round(p.size * p.entry / p.leverage, 4)), createdTime: p.createdTime };
        }),
        orders: account.orders.map(publicOrder),
      };
    },
    async history(userId) {
      const account = load(userId);
      return { orders: account.history.slice(0, 50).map(({ realised, ...entry }) => entry) };
    },
    async setLeverage(userId, symbol, leverage) {
      const info = await data.instrument(symbol);
      const value = positive(leverage);
      if (!value || value > info.maxLeverage) throw new TradingError(400, `Leverage must be between 1 and ${info.maxLeverage}x.`);
      const account = load(userId);
      if (account.positions[symbol] && account.positions[symbol].leverage !== value)
        throw new TradingError(400, "Close the open position before changing its leverage.");
      account.leverage[symbol] = value; save(userId); flush();
      return { leverage: value };
    },
    async placeOrder(userId, input = {}) {
      const symbol = String(input.symbol ?? "");
      const info = await data.instrument(symbol);
      const side = input.side === "Buy" || input.side === "Sell" ? input.side : null;
      const type = ["market", "limit", "stop", "stopLimit"].includes(input.type) ? input.type : null;
      if (!side || !type) throw new TradingError(400, "Choose Buy or Sell and an order type.");
      const qty = num(toStep(input.qty, info.qtyStep));
      if (!qty || qty < Number(info.minQty)) throw new TradingError(400, `Minimum amount is ${info.minQty} ${info.base}.`);
      if (qty > Number(info.maxQty)) throw new TradingError(400, `Maximum amount per order is ${info.maxQty} ${info.base}.`);
      const { account, tickers } = await withAccount(userId);
      const m = marks(tickers, symbol);
      if (!m?.last) throw new TradingError(503, "No live price for this contract right now.");
      const existing = account.positions[symbol];
      let leverage = positive(input.leverage) ?? existing?.leverage ?? account.leverage[symbol] ?? 10;
      if (leverage > info.maxLeverage) throw new TradingError(400, `Leverage must be between 1 and ${info.maxLeverage}x.`);
      if (existing && existing.leverage !== leverage) leverage = existing.leverage; // one leverage per open position
      account.leverage[symbol] = leverage;
      const order = { orderId: randomUUID(), symbol, side, qty, leverage, createdTime: now(), reduceOnly: !!input.reduceOnly,
        orderType: type === "limit" || type === "stopLimit" ? "Limit" : "Market" };
      if (order.orderType === "Limit") {
        order.price = num(toStep(input.price, info.tickSize, "round"));
        if (!positive(order.price)) throw new TradingError(400, "Enter a limit price.");
        order.timeInForce = ["GTC", "IOC", "FOK", "PostOnly"].includes(input.timeInForce) ? input.timeInForce : "GTC";
      }
      if (type === "stop" || type === "stopLimit") {
        order.triggerPrice = num(toStep(input.triggerPrice, info.tickSize, "round"));
        if (!positive(order.triggerPrice)) throw new TradingError(400, "Enter a stop (trigger) price.");
        order.triggerDirection = order.triggerPrice > m.last ? 1 : 2;
      }
      if (positive(input.takeProfit)) order.takeProfit = num(toStep(input.takeProfit, info.tickSize, "round"));
      if (positive(input.stopLoss)) order.stopLoss = num(toStep(input.stopLoss, info.tickSize, "round"));
      if (order.reduceOnly && (!existing || existing.side === side)) throw new TradingError(400, "Reduce-only needs an open position on the other side.");
      // Margin check for anything that opens or adds exposure.
      const opening = order.reduceOnly ? 0 : existing && existing.side !== side ? Math.max(0, qty - existing.size) : qty;
      const refPrice = order.price ?? order.triggerPrice ?? (side === "Buy" ? m.ask : m.bid);
      const s = summary(account, tickers);
      const needed = opening * refPrice / leverage + opening * refPrice * TAKER;
      if (needed > s.available + 1e-9) throw new TradingError(400, `Not enough available balance (needs ${needed.toFixed(2)} USDT, available ${s.available.toFixed(2)}).`);
      if (order.orderType === "Limit" && order.timeInForce === "PostOnly" && !order.triggerPrice &&
        (side === "Buy" ? order.price >= m.ask : order.price <= m.bid)) throw new TradingError(400, "Post-only order would take liquidity; it was cancelled.");
      const marketable = order.orderType === "Limit" && !order.triggerPrice && (side === "Buy" ? order.price >= m.ask : order.price <= m.bid);
      if ((order.orderType === "Market" && !order.triggerPrice) || marketable) {
        const price = order.orderType === "Market" ? (side === "Buy" ? m.ask : m.bid) : (side === "Buy" ? Math.min(order.price, m.ask) : Math.max(order.price, m.bid));
        const realised = fill(account, { ...order, price, fee: TAKER });
        record(account, historyEntry({ ...publicOrder(order), price: String(price), filled: String(qty), status: "Filled", realised }));
      } else if (order.orderType === "Limit" && !order.triggerPrice && ["IOC", "FOK"].includes(order.timeInForce)) {
        record(account, historyEntry({ ...publicOrder(order), status: "Cancelled" }));
      } else {
        account.orders.push(order);
      }
      save(userId); flush();
      return { orderId: order.orderId };
    },
    async cancelOrder(userId, { orderId } = {}) {
      const account = load(userId);
      const order = account.orders.find(o => o.orderId === orderId);
      if (!order) throw new TradingError(404, "Order not found.");
      account.orders = account.orders.filter(o => o !== order);
      record(account, historyEntry({ ...publicOrder(order), status: "Cancelled" }));
      save(userId); flush();
      return { ok: true };
    },
    async cancelAll(userId, { symbol } = {}) {
      const account = load(userId);
      for (const order of account.orders.filter(o => !symbol || o.symbol === symbol)) record(account, historyEntry({ ...publicOrder(order), status: "Cancelled" }));
      account.orders = account.orders.filter(o => symbol && o.symbol !== symbol);
      save(userId); flush();
      return { ok: true };
    },
    async closePosition(userId, { symbol, qty, price } = {}) {
      const account = load(userId);
      const position = account.positions[String(symbol)];
      if (!position) throw new TradingError(404, "No open position.");
      return this.placeOrder(userId, { symbol: position.symbol, side: position.side === "Buy" ? "Sell" : "Buy", qty: positive(qty) ? Math.min(qty, position.size) : position.size,
        type: positive(price) ? "limit" : "market", price, reduceOnly: true });
    },
    async setTradingStop(userId, { symbol, takeProfit, stopLoss } = {}) {
      const info = await data.instrument(String(symbol ?? ""));
      const account = load(userId);
      const position = account.positions[info.symbol];
      if (!position) throw new TradingError(404, "No open position.");
      if (takeProfit !== undefined) position.takeProfit = positive(takeProfit) ? num(toStep(takeProfit, info.tickSize, "round")) : null;
      if (stopLoss !== undefined) position.stopLoss = positive(stopLoss) ? num(toStep(stopLoss, info.tickSize, "round")) : null;
      save(userId); flush();
      return { ok: true };
    },
    reset(userId) { accounts.set(userId, fresh()); save(userId); flush(); return { ok: true }; },
  };
}
