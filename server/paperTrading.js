// Paper trading for every signed-in user: a simulated USDT-perpetual account per user,
// priced and matched against LIVE exchange prices (public endpoints, no keys) of
// whichever exchange the chart shows. Same request/response shapes as the real Bybit
// routes (plus `exchange`), so the UI is shared.
//
// Model (simplified one-way, cross margin):
// - wallet: USDT; each position {side, size, entry, leverage, tp, sl}; margin = size*entry/leverage
// - equity = wallet + unrealised PnL; available = equity - position margin - open-order margin
// - fills: market at bid/ask (market fee), limit when the last price reaches it (limit fee),
//   stop / stop-limit trigger on the last price, TP/SL close at market, liquidation when the mark
//   crosses entry * (1 ∓ 1/leverage ± 0.5%) (isolated-style: the position's margin is lost)
// - settings per user: starting balance (USDT), commission on/off, market and limit fee %
// Accounts are saved as JSON per user in .cache/paper/ and checked every 2 s while anything is open.
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { TradingError, toStep } from "./bybitTrading.js";

export const PAPER_DEFAULTS = { startBalance: 10_000, commission: true, marketFeePct: 0.05, limitFeePct: 0.02 };
export const PAPER_START_BALANCE = PAPER_DEFAULTS.startBalance;
const MMR = 0.005, MAX_LEVERAGE = 100;
const SYMBOL = /^[A-Za-z0-9_.:/-]{2,40}$/, EXCHANGE = /^[a-z0-9]{2,20}$/, ASSET = /^[A-Z0-9]{1,30}$/;
const num = value => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const positive = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
const round = (value, digits = 8) => Math.round(value * 10 ** digits) / 10 ** digits;
const keyOf = (exchange, symbol) => `${exchange}:${symbol}`;

export function liquidationPrice(position) {
  const dir = position.side === "Buy" ? 1 : -1;
  return position.entry * (1 - dir / position.leverage + dir * MMR);
}

/** Lot and tick sizes for venues whose contract rules are not loaded: ~6 significant price digits, ~$1 lots. */
export function genericRules(price) {
  const p = positive(price) ?? 1;
  const tickExp = Math.floor(Math.log10(p)) - 5, qtyExp = Math.floor(Math.log10(1 / p));
  const fmt = exp => exp >= 0 ? String(10 ** exp) : (10 ** exp).toFixed(-exp);
  return { tickSize: fmt(tickExp), qtyStep: fmt(qtyExp), minQty: fmt(qtyExp), maxQty: "1000000000", maxLeverage: MAX_LEVERAGE };
}

// Bulk "every contract" quote endpoints: one request per exchange, shared by every user.
const QUOTE_SOURCES = {
  bybit: { url: "https://api.bybit.com/v5/market/tickers?category=linear", rows: b => b?.result?.list,
    row: r => [r.symbol, r.lastPrice, r.bid1Price, r.ask1Price, r.markPrice] },
  binance: { url: "https://fapi.binance.com/fapi/v1/ticker/bookTicker", rows: b => b,
    row: r => [r.symbol, (Number(r.bidPrice) + Number(r.askPrice)) / 2, r.bidPrice, r.askPrice] },
  okx: { url: "https://www.okx.com/api/v5/market/tickers?instType=SWAP", rows: b => b?.data, row: r => [r.instId, r.last, r.bidPx, r.askPx] },
  bitget: { url: "https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", rows: b => b?.data,
    row: r => [r.symbol, r.lastPr, r.bidPr, r.askPr, r.markPrice] },
  gate: { url: "https://api.gateio.ws/api/v4/futures/usdt/tickers", rows: b => b, row: r => [r.contract, r.last, r.highest_bid, r.lowest_ask, r.mark_price] },
  mexc: { url: "https://contract.mexc.com/api/v1/contract/ticker", rows: b => b?.data, row: r => [r.symbol, r.lastPrice, r.bid1, r.ask1, r.fairPrice] },
};
export const PAPER_LIVE_EXCHANGES = Object.keys(QUOTE_SOURCES);

/**
 * Live quotes: {last, bid, ask, mark} for (exchange, symbol). Exchanges without a bulk source
 * here use the same coin's Bybit USDT contract. Bulk lists are cached ~1.5 s.
 */
export function createLiveQuotes({ request = async url => (await fetch(url, { signal: AbortSignal.timeout(10_000) })).json(), now = Date.now } = {}) {
  const lists = new Map(); // exchange -> {at, map, pending}
  const instruments = new Map();
  async function list(exchange) {
    const source = QUOTE_SOURCES[exchange];
    let state = lists.get(exchange);
    if (state && now() - state.at < 1500) return state.map;
    if (state?.pending) return state.pending;
    const pending = request(source.url).then(body => {
      const map = new Map();
      for (const raw of source.rows(body) ?? []) {
        const [symbol, last, bid, ask, mark] = source.row(raw);
        const l = positive(last), b = positive(bid) ?? l, a = positive(ask) ?? l;
        if (symbol && l) map.set(symbol, { last: l, bid: b, ask: a, mark: positive(mark) ?? l });
      }
      lists.set(exchange, { at: now(), map, pending: null });
      return map;
    }).catch(error => { lists.set(exchange, { ...(lists.get(exchange) ?? { at: 0, map: new Map() }), pending: null }); throw error; });
    lists.set(exchange, { at: state?.at ?? 0, map: state?.map ?? new Map(), pending });
    return pending;
  }
  async function quote(exchange, symbol, asset) {
    if (QUOTE_SOURCES[exchange]) {
      const found = (await list(exchange).catch(() => new Map())).get(symbol);
      if (found) return { ...found, source: exchange };
    }
    if (asset) {
      const found = (await list("bybit").catch(() => new Map())).get(`${asset}USDT`);
      if (found) return { ...found, source: "bybit" };
    }
    return null;
  }
  async function bybitRules(symbol) {
    const cached = instruments.get(symbol);
    if (cached && now() - cached.at < 3600_000) return cached.info;
    let info = null;
    try {
      const body = await request(`https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${encodeURIComponent(symbol)}`);
      const row = body?.result?.list?.[0];
      if (row?.status === "Trading") info = { tickSize: row.priceFilter.tickSize, qtyStep: row.lotSizeFilter.qtyStep, minQty: row.lotSizeFilter.minOrderQty,
        maxQty: row.lotSizeFilter.maxOrderQty, maxLeverage: Number(row.leverageFilter.maxLeverage) };
    } catch { info = null; }
    instruments.set(symbol, { at: now(), info });
    return info;
  }
  /** Contract rules: Bybit's own for Bybit contracts, otherwise generic from the price. */
  async function instrument(exchange, symbol, asset) {
    const q = await quote(exchange, symbol, asset);
    if (!q) throw new TradingError(404, "No live price for this contract right now.");
    const rules = (exchange === "bybit" && await bybitRules(symbol)) || genericRules(q.last);
    return { symbol, exchange, base: asset || symbol.replace(/[-_]?USDT.*$/i, ""), ...rules };
  }
  return { quote, instrument };
}

export function createPaperTrading({ data = createLiveQuotes(), directory = null, now = Date.now, timers = true } = {}) {
  const accounts = new Map(); // userId -> account
  const dirty = new Set();
  const fresh = (settings = PAPER_DEFAULTS) => ({ wallet: settings.startBalance, settings: { ...settings }, positions: {}, orders: [], history: [], leverage: {}, createdAt: now() });
  const file = userId => join(directory, `${userId}.json`);
  function load(userId) {
    if (accounts.has(userId)) return accounts.get(userId);
    let account = fresh();
    if (directory) { try { const saved = JSON.parse(readFileSync(file(userId), "utf8")); account = { ...fresh(), ...saved, settings: { ...PAPER_DEFAULTS, ...saved.settings } }; } catch { /* new */ } }
    accounts.set(userId, account);
    return account;
  }
  const save = userId => dirty.add(userId);
  function flush() {
    if (!directory) { dirty.clear(); return; }
    try { mkdirSync(directory, { recursive: true }); } catch { return; }
    for (const userId of dirty) {
      try { writeFileSync(`${file(userId)}.tmp`, JSON.stringify(accounts.get(userId))); renameSync(`${file(userId)}.tmp`, file(userId)); } catch { /* next flush */ }
    }
    dirty.clear();
  }
  // Watch accounts with open orders/positions even when their owner is offline.
  if (directory) {
    try { for (const name of readdirSync(directory)) if (/^\d+\.json$/.test(name)) load(Number(name.slice(0, -5))); } catch { /* none yet */ }
  }
  const fee = (account, kind) => account.settings.commission ? (kind === "market" ? account.settings.marketFeePct : account.settings.limitFeePct) / 100 : 0;

  const historyEntry = fields => ({ orderId: randomUUID(), createdTime: now(), updatedTime: now(), reduceOnly: false, ...fields });
  const record = (account, entry) => { account.history.unshift(entry); account.history.length = Math.min(account.history.length, 200); };

  /** Fill qty at price; returns realised PnL. */
  function fill(account, { exchange, symbol, asset, side, qty, price, feeRate, leverage, reduceOnly, takeProfit, stopLoss }) {
    const key = keyOf(exchange, symbol);
    let position = account.positions[key];
    let realised = 0;
    account.wallet -= qty * price * feeRate;
    if (position && position.side !== side) {
      const closing = Math.min(qty, position.size), dir = position.side === "Buy" ? 1 : -1;
      realised = (price - position.entry) * closing * dir;
      account.wallet += realised;
      position.size = round(position.size - closing);
      position.realised = (position.realised ?? 0) + realised;
      qty = round(qty - closing);
      if (position.size <= 0) { delete account.positions[key]; position = null; }
      if (reduceOnly) qty = 0;
    }
    if (qty > 0 && !reduceOnly) {
      if (position) {
        position.entry = (position.entry * position.size + price * qty) / (position.size + qty);
        position.size = round(position.size + qty);
      } else {
        position = account.positions[key] = { exchange, symbol, asset, side, size: qty, entry: price, leverage: leverage ?? account.leverage[key] ?? 10,
          takeProfit: null, stopLoss: null, realised: 0, createdTime: now() };
      }
      if (takeProfit) position.takeProfit = takeProfit;
      if (stopLoss) position.stopLoss = stopLoss;
    }
    return realised;
  }

  /** Quotes for every contract the account touches. */
  async function quotesFor(account, extra = []) {
    const wanted = new Map();
    for (const item of [...Object.values(account.positions), ...account.orders, ...extra]) wanted.set(keyOf(item.exchange, item.symbol), item);
    const out = new Map();
    await Promise.all([...wanted].map(async ([key, item]) => { const q = await data.quote(item.exchange, item.symbol, item.asset).catch(() => null); if (q) out.set(key, q); }));
    return out;
  }
  function summary(account, quotes) {
    let unrealised = 0, margin = 0;
    for (const [key, p] of Object.entries(account.positions)) {
      const m = quotes.get(key)?.mark ?? p.entry;
      unrealised += (m - p.entry) * p.size * (p.side === "Buy" ? 1 : -1);
      margin += p.size * p.entry / p.leverage;
    }
    const orderMargin = account.orders.filter(o => !o.reduceOnly).reduce((sum, o) => sum + o.qty * (o.price ?? o.triggerPrice ?? 0) / o.leverage, 0);
    const equity = account.wallet + unrealised;
    return { unrealised, margin, orderMargin, equity, available: Math.max(0, equity - margin - orderMargin) };
  }

  /** Matching engine for one account. */
  function match(account, quotes) {
    let changed = false;
    for (const order of [...account.orders]) {
      const m = quotes.get(keyOf(order.exchange, order.symbol));
      if (!m?.last) continue;
      if (order.triggerPrice && !order.triggered) {
        const hit = order.triggerDirection === 1 ? m.last >= order.triggerPrice : m.last <= order.triggerPrice;
        if (!hit) continue;
        order.triggered = true; changed = true;
        if (order.orderType === "Market") {
          const price = order.side === "Buy" ? m.ask : m.bid;
          const realised = fill(account, { ...order, price, feeRate: fee(account, "market") });
          account.orders = account.orders.filter(o => o !== order);
          record(account, historyEntry({ ...publicOrder(order), price: String(price), filled: String(order.qty), status: "Filled", realised }));
          continue;
        }
      }
      if (order.orderType === "Limit" && (!order.triggerPrice || order.triggered)) {
        const reached = order.side === "Buy" ? m.last <= order.price : m.last >= order.price;
        if (!reached) continue;
        const realised = fill(account, { ...order, price: order.price, feeRate: fee(account, "limit") });
        account.orders = account.orders.filter(o => o !== order);
        record(account, historyEntry({ ...publicOrder(order), price: String(order.price), filled: String(order.qty), status: "Filled", realised }));
        changed = true;
      }
    }
    for (const [key, position] of Object.entries(account.positions)) {
      const m = quotes.get(key);
      if (!m?.last) continue;
      const long = position.side === "Buy", closeSide = long ? "Sell" : "Buy";
      const liq = liquidationPrice(position);
      let reason = null, price = null;
      if (long ? m.mark <= liq : m.mark >= liq) { reason = "Liquidated"; price = liq; }
      else if (position.takeProfit && (long ? m.last >= position.takeProfit : m.last <= position.takeProfit)) { reason = "TakeProfit"; price = long ? m.bid : m.ask; }
      else if (position.stopLoss && (long ? m.last <= position.stopLoss : m.last >= position.stopLoss)) { reason = "StopLoss"; price = long ? m.bid : m.ask; }
      if (!reason) continue;
      const qty = position.size;
      const realised = fill(account, { ...position, side: closeSide, qty, price, feeRate: fee(account, "market"), reduceOnly: true });
      account.orders = account.orders.filter(o => !(keyOf(o.exchange, o.symbol) === key && o.reduceOnly));
      record(account, historyEntry({ exchange: position.exchange, symbol: position.symbol, side: closeSide, orderType: "Market", stopOrderType: reason, qty: String(qty),
        price: String(price), filled: String(qty), status: reason === "Liquidated" ? "Liquidated" : "Filled", reduceOnly: true, realised }));
      changed = true;
    }
    if (account.wallet < 0) account.wallet = 0;
    return changed;
  }

  const publicOrder = o => ({ orderId: o.orderId, exchange: o.exchange, symbol: o.symbol, side: o.side, orderType: o.orderType, price: o.price ? String(o.price) : null,
    triggerPrice: o.triggerPrice ? String(o.triggerPrice) : null, qty: String(o.qty), filled: "0", status: o.triggerPrice && !o.triggered ? "Untriggered" : "New",
    reduceOnly: !!o.reduceOnly, stopOrderType: o.triggerPrice ? "Stop" : null, takeProfit: o.takeProfit ? String(o.takeProfit) : null,
    stopLoss: o.stopLoss ? String(o.stopLoss) : null, timeInForce: o.timeInForce ?? null, createdTime: o.createdTime });

  async function tick() {
    const active = [...accounts].filter(([, account]) => account.orders.length || Object.keys(account.positions).length);
    for (const [userId, account] of active) {
      const quotes = await quotesFor(account);
      if (match(account, quotes)) save(userId);
    }
    flush();
  }
  let timer = null;
  if (timers) { timer = setInterval(() => { tick().catch(() => {}); }, 2000); timer.unref?.(); }

  async function withAccount(userId, extra = []) {
    const account = load(userId);
    const quotes = await quotesFor(account, extra);
    if (match(account, quotes)) { save(userId); flush(); }
    return { account, quotes };
  }
  const contract = input => {
    const exchange = String(input?.exchange ?? "bybit").toLowerCase(), symbol = String(input?.symbol ?? ""), asset = String(input?.asset ?? "").toUpperCase();
    if (!EXCHANGE.test(exchange) || !SYMBOL.test(symbol) || (asset && !ASSET.test(asset))) throw new TradingError(400, "Unknown contract.");
    return { exchange, symbol, asset: asset || null };
  };

  const service = {
    tick,
    stop: () => { if (timer) clearInterval(timer); timer = null; flush(); },
    async market(userId, query) {
      const c = contract(query);
      const info = await data.instrument(c.exchange, c.symbol, c.asset);
      const { account, quotes } = await withAccount(userId, [c]);
      const q = quotes.get(keyOf(c.exchange, c.symbol)) ?? {};
      const key = keyOf(c.exchange, c.symbol);
      return { ...info, bid: q.bid != null ? String(q.bid) : null, ask: q.ask != null ? String(q.ask) : null, last: q.last != null ? String(q.last) : null,
        mark: q.mark != null ? String(q.mark) : null, priceSource: q.source ?? null,
        leverage: account.positions[key]?.leverage ?? account.leverage[key] ?? 10 };
    },
    async account(userId) {
      const { account, quotes } = await withAccount(userId);
      const s = summary(account, quotes);
      return {
        testnet: false, paper: true, settings: account.settings, startBalance: account.settings.startBalance,
        balance: { equity: String(round(s.equity, 4)), marginBalance: String(round(s.equity, 4)), available: String(round(s.available, 4)),
          walletUsdt: String(round(account.wallet, 4)), unrealisedPnl: String(round(s.unrealised, 4)) },
        positions: Object.entries(account.positions).map(([key, p]) => {
          const m = quotes.get(key)?.mark ?? p.entry, dir = p.side === "Buy" ? 1 : -1;
          return { exchange: p.exchange, asset: p.asset, symbol: p.symbol, side: p.side, size: String(p.size), entryPrice: String(round(p.entry)), markPrice: String(m),
            liqPrice: String(round(liquidationPrice(p))), leverage: String(p.leverage), positionValue: String(round(p.size * m, 4)),
            unrealisedPnl: String(round((m - p.entry) * p.size * dir, 4)), realisedPnl: String(round(p.realised ?? 0, 4)),
            takeProfit: p.takeProfit ? String(p.takeProfit) : null, stopLoss: p.stopLoss ? String(p.stopLoss) : null,
            margin: String(round(p.size * p.entry / p.leverage, 4)), createdTime: p.createdTime };
        }),
        orders: account.orders.map(publicOrder),
      };
    },
    async history(userId) {
      return { orders: load(userId).history.slice(0, 50).map(({ realised, ...entry }) => entry) };
    },
    async placeOrder(userId, input = {}) {
      const c = contract(input), key = keyOf(c.exchange, c.symbol);
      const info = await data.instrument(c.exchange, c.symbol, c.asset);
      const side = input.side === "Buy" || input.side === "Sell" ? input.side : null;
      const type = ["market", "limit", "stop", "stopLimit"].includes(input.type) ? input.type : null;
      if (!side || !type) throw new TradingError(400, "Choose Buy or Sell and an order type.");
      const qty = num(toStep(input.qty, info.qtyStep));
      if (!qty || qty < Number(info.minQty)) throw new TradingError(400, `Minimum amount is ${info.minQty} ${info.base}.`);
      if (qty > Number(info.maxQty)) throw new TradingError(400, `Maximum amount per order is ${info.maxQty} ${info.base}.`);
      const { account, quotes } = await withAccount(userId, [c]);
      const m = quotes.get(key);
      if (!m?.last) throw new TradingError(503, "No live price for this contract right now.");
      const existing = account.positions[key];
      let leverage = positive(input.leverage) ?? existing?.leverage ?? account.leverage[key] ?? 10;
      if (leverage > info.maxLeverage) throw new TradingError(400, `Leverage must be between 1 and ${info.maxLeverage}x.`);
      if (existing && existing.leverage !== leverage) leverage = existing.leverage; // one leverage per open position
      account.leverage[key] = leverage;
      const order = { orderId: randomUUID(), ...c, side, qty, leverage, createdTime: now(), reduceOnly: !!input.reduceOnly,
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
      const opening = order.reduceOnly ? 0 : existing && existing.side !== side ? Math.max(0, qty - existing.size) : qty;
      const refPrice = order.price ?? order.triggerPrice ?? (side === "Buy" ? m.ask : m.bid);
      const s = summary(account, quotes);
      const needed = opening * refPrice / leverage + opening * refPrice * fee(account, "market");
      if (needed > s.available + 1e-9) throw new TradingError(400, `Not enough available balance (needs ${needed.toFixed(2)} USDT, available ${s.available.toFixed(2)}).`);
      if (order.orderType === "Limit" && order.timeInForce === "PostOnly" && !order.triggerPrice &&
        (side === "Buy" ? order.price >= m.ask : order.price <= m.bid)) throw new TradingError(400, "Post-only order would take liquidity; it was cancelled.");
      const marketable = order.orderType === "Limit" && !order.triggerPrice && (side === "Buy" ? order.price >= m.ask : order.price <= m.bid);
      if ((order.orderType === "Market" && !order.triggerPrice) || marketable) {
        const price = order.orderType === "Market" ? (side === "Buy" ? m.ask : m.bid) : (side === "Buy" ? Math.min(order.price, m.ask) : Math.max(order.price, m.bid));
        const realised = fill(account, { ...order, price, feeRate: fee(account, "market") });
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
    async closePosition(userId, input = {}) {
      const c = contract(input);
      const position = load(userId).positions[keyOf(c.exchange, c.symbol)];
      if (!position) throw new TradingError(404, "No open position.");
      return service.placeOrder(userId, { ...c, asset: position.asset ?? c.asset, side: position.side === "Buy" ? "Sell" : "Buy",
        qty: positive(input.qty) ? Math.min(input.qty, position.size) : position.size, type: positive(input.price) ? "limit" : "market", price: input.price, reduceOnly: true });
    },
    async setTradingStop(userId, input = {}) {
      const c = contract(input);
      const info = await data.instrument(c.exchange, c.symbol, c.asset);
      const position = load(userId).positions[keyOf(c.exchange, c.symbol)];
      if (!position) throw new TradingError(404, "No open position.");
      if (input.takeProfit !== undefined) position.takeProfit = positive(input.takeProfit) ? num(toStep(input.takeProfit, info.tickSize, "round")) : null;
      if (input.stopLoss !== undefined) position.stopLoss = positive(input.stopLoss) ? num(toStep(input.stopLoss, info.tickSize, "round")) : null;
      save(userId); flush();
      return { ok: true };
    },
    /** Commission settings apply at once; a new starting balance resets the account. */
    settings(userId, input = {}) {
      const account = load(userId), next = { ...account.settings };
      if (input.commission !== undefined) next.commission = !!input.commission;
      for (const field of ["marketFeePct", "limitFeePct"]) if (input[field] !== undefined) {
        const value = num(input[field]);
        if (value === null || value < 0 || value > 1) throw new TradingError(400, "Fees must be between 0% and 1%.");
        next[field] = value;
      }
      if (input.startBalance !== undefined && Number(input.startBalance) !== account.settings.startBalance) {
        const balance = num(input.startBalance);
        if (!balance || balance < 10 || balance > 100_000_000) throw new TradingError(400, "Starting balance must be between 10 and 100,000,000 USDT.");
        next.startBalance = balance;
        accounts.set(userId, fresh(next));
      } else account.settings = next;
      save(userId); flush();
      return { settings: next };
    },
    reset(userId) { accounts.set(userId, fresh(load(userId).settings)); save(userId); flush(); return { ok: true }; },
  };
  return service;
}
