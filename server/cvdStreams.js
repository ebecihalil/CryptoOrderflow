import WebSocket from "ws";
import { requestJson, requestGates } from "./exchangeRequests.js";
import { SPOT_URLS } from "./cvdMarkets.js";
import { decodeTradeMessage, parseCvdTrades } from "./cvdTradeCodec.js";

const URLS = {
  binance: ["wss://stream.binance.com:9443/ws", "wss://fstream.binance.com/market/ws"],
  bybit: ["wss://stream.bybit.com/v5/public/spot", "wss://stream.bybit.com/v5/public/linear"],
  okx: ["wss://ws.okx.com:8443/ws/v5/public", "wss://ws.okx.com:8443/ws/v5/public"],
  gate: ["wss://api.gateio.ws/ws/v4/", "wss://fx-ws.gateio.ws/v4/ws/usdt"],
  mexc: ["wss://wbs-api.mexc.com/ws", "wss://contract.mexc.com/edge"],
  bitget: ["wss://ws.bitget.com/v2/ws/public", "wss://ws.bitget.com/v2/ws/public"],
  bingx: ["wss://open-api-ws.bingx.com/market", "wss://open-api-swap.bingx.com/swap-market"],
  kraken: ["wss://ws.kraken.com/v2", "wss://futures.kraken.com/ws/v1"],
  htx: ["wss://api.huobi.pro/ws", "wss://api.hbdm.com/linear-swap-ws"],
};
export function cvdSubscription(exchange, market, symbol, id, time) {
  switch (exchange) {
    case "binance": return { method: "SUBSCRIBE", params: [`${symbol.toLowerCase()}@aggTrade`], id };
    case "bybit": return { op: "subscribe", args: [`publicTrade.${symbol}`] };
    case "okx": return { op: "subscribe", args: [{ channel: "trades", instId: symbol }] };
    case "gate": return { time: Math.floor(time / 1000), channel: market === "spot" ? "spot.trades" : "futures.trades", event: "subscribe", payload: [symbol] };
    case "mexc": return market === "spot" ? { method: "SUBSCRIPTION", params: [`spot@public.aggre.deals.v3.api.pb@100ms@${symbol}`] }
      : { method: "sub.deal", param: { symbol, compress: false } };
    case "bitget": return { op: "subscribe", args: [{ instType: market === "spot" ? "SPOT" : "USDT-FUTURES", channel: "trade", instId: symbol }] };
    case "bingx": return { id: String(id), reqType: "sub", dataType: `${symbol}@trade` };
    case "kucoin": return { id: String(id), type: "subscribe", topic: `${market === "spot" ? "/market/match" : "/contractMarket/execution"}:${symbol}`, privateChannel: false, response: true };
    case "kraken": return market === "spot" ? { method: "subscribe", params: { channel: "trade", symbol: [symbol], snapshot: false } }
      : { event: "subscribe", feed: "trade", product_ids: [symbol] };
    case "htx": return { sub: `market.${symbol}.trade.detail`, id: String(id) };
    default: throw new Error("Unknown trade feed.");
  }
}

export function liquidationSubscription(exchange, symbol, id, time) {
  switch (exchange) {
    case "binance": return { method: "SUBSCRIBE", params: [`${symbol.toLowerCase()}@forceOrder`], id };
    case "bybit": return { op: "subscribe", args: [`allLiquidation.${symbol}`] };
    default: return null;
  }
}

export function parseLiquidation(exchange, message, instrument) {
  const records = exchange === "binance"
    ? (message?.e === "forceOrder" && message.o ? [message.o] : [])
    : exchange === "bybit" && message?.topic?.startsWith("allLiquidation.")
      ? (Array.isArray(message.data) ? message.data : [message.data])
      : [];
  return records.flatMap(record => {
    const price = Number(record.ap ?? record.p), quantity = Number(record.q ?? record.v);
    const time = Number(record.T ?? message.E ?? message.ts);
    if (!(Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity > 0 &&
      Number.isFinite(time) && time > 0)) return [];
    const action = String(record.S ?? record.S).toLowerCase();
    // Bybit Buy means a long position was liquidated; Binance BUY order closes shorts.
    const side = exchange === "bybit"
      ? action === "buy" ? "long" : action === "sell" ? "short" : null
      : action === "sell" ? "long" : action === "buy" ? "short" : null;
    return side ? [{ exchange, symbol: instrument.symbol, side, time, usd: price * quantity }] : [];
  });
}

export function createCvdStreamFactory({
  request = requestJson, gates = requestGates, Socket = WebSocket, now = Date.now,
  wait = delay => new Promise(resolve => setTimeout(resolve, delay)),
} = {}) {
  const starts = new Map();
  // ALL CVD sockets share per-exchange connection spacing across spot, perp and assets.
  // An API refresh reuses a collector; it never forces an upstream reconnect.
  async function start(instrument, onTrade, onState, onLiquidation = () => {}) {
    const { exchange, market, symbol } = instrument;
    let stopped = false, ws, pulse, life, previousStart, generation = 0;
    const unsubscribeCooldown = exchange === "binance"
      ? gates[exchange]?.onCooldown?.(() => ws?.close())
      : undefined;
    const send = message => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(typeof message === "string" ? message : JSON.stringify(message));
    };
    const dispose = () => { clearInterval(pulse); clearTimeout(life); ws?.close(); };
    const connect = async () => {
      const thisGeneration = ++generation;
      try {
        const gate = gates[exchange];
        if (gate?.isCoolingDown) throw gate.cooldownError();
        previousStart = starts.get(exchange) ?? 0;
        const admitted = Math.max(now(), previousStart + 2000);
        starts.set(exchange, admitted);
        await wait(Math.max(0, admitted - now()));
        if (stopped || thisGeneration !== generation) return;
        // Count connection admission conservatively against the existing shared budget.
        await gate?.enter(SPOT_URLS[exchange]);
        let url = URLS[exchange]?.[market === "spot" ? 0 : 1];
        let heartbeatMs = 20_000;
        if (exchange === "kucoin") {
          const body = await request(`https://${market === "spot" ? "api.kucoin.com" : "api-futures.kucoin.com"}/api/v1/bullet-public`, { method: "POST" });
          const server = body.data?.instanceServers?.[0];
          if (!server || !body.data.token || !server.endpoint.startsWith("wss://") ||
            !Number.isFinite(Number(server.pingInterval)) || Number(server.pingInterval) < 6000) throw new Error("Public trade connection unavailable.");
          url = `${server.endpoint}?token=${encodeURIComponent(body.data.token)}&connectId=${now()}`;
          heartbeatMs = Math.max(5000, Math.min(15000, Number(server.pingInterval) - 1000));
        }
        if (stopped || thisGeneration !== generation) return;
        if (!url) throw new Error("Trade endpoint unavailable.");
        // A different request can trip the shared exchange cooldown while a
        // stream is being prepared. Check immediately before opening a socket.
        if (gate?.isCoolingDown) throw gate.cooldownError();
        const socket = new Socket(url, {
          handshakeTimeout: 12_000, maxPayload: 4_000_000,
          ...(exchange === "gate" && market === "perpetual" ? { headers: { "X-Gate-Size-Decimal": "1" } } : {}),
        });
        ws = socket;
        let receivedAt = now(), subscribedAt = 0, frameSequence = 0;
        socket.on("open", () => {
          if (stopped || thisGeneration !== generation) { socket.close(); return; }
          if (gate?.isCoolingDown) { socket.close(); return; }
          subscribedAt = now(); onState("idle");
          send(cvdSubscription(exchange, market, symbol, 1, now()));
          const liquidation = market === "perpetual" ? liquidationSubscription(exchange, symbol, 2, now()) : null;
          if (liquidation) send(liquidation);
          pulse = setInterval(() => {
            if (now() - receivedAt > 75_000) { socket.terminate(); return; }
            if (exchange === "bybit") send({ op: "ping" });
            else if (exchange === "okx" || exchange === "bitget") send("ping");
            else if (exchange === "mexc") send({ method: market === "spot" ? "PING" : "ping" });
            else if (exchange === "kucoin") send({ id: String(now()), type: "ping" });
            else socket.ping();
          }, heartbeatMs);
          pulse.unref?.();
          // Binance/MEXC connections have 24h limits; rotate before expiry and mark gap.
          life = setTimeout(() => socket.close(), 23 * 3600_000);
          life.unref?.();
        });
        socket.on("pong", () => { receivedAt = now(); });
        socket.on("message", raw => {
          if (stopped || thisGeneration !== generation) return;
          if (gate?.isCoolingDown) return;
          receivedAt = now();
          try {
            const message = decodeTradeMessage(exchange, market, raw);
            if (message.heartbeat === "Ping") { send("Pong"); return; }
            if (message.ping !== undefined) { send({ pong: message.ping }); return; }
            if (message.event === "error" || message.type === "error" || message.success === false ||
              message.error || (message.code !== undefined && Number(message.code) !== 0)) {
              onState("unavailable"); socket.close(); return;
            }
            if (market === "perpetual") {
              for (const event of parseLiquidation(exchange, message, instrument)) {
                if (event.time >= subscribedAt && event.time <= now() + 5000) onLiquidation(event);
              }
            }
            for (const trade of parseCvdTrades(exchange, market, message, instrument, `${subscribedAt}:${thisGeneration}:${++frameSequence}`)) {
              // Subscription snapshots/replays cannot masquerade as complete old history.
              if (trade.time >= subscribedAt && trade.time <= now() + 5000) onTrade(trade);
            }
          } catch { onState("unavailable"); socket.close(); }
        });
        socket.on("unexpected-response", (_req, response) => {
          void gate?.inspect({ status: response.statusCode, headers: new Headers(
            Object.fromEntries(Object.entries(response.headers).filter(([,v]) => typeof v === "string"))) })
            .catch(() => {});
          response.resume(); socket.terminate();
        });
        socket.on("error", () => {});
        socket.on("close", () => {
          if (thisGeneration !== generation) return;
          clearInterval(pulse); clearTimeout(life);
          if (!stopped) { onState("reconnecting"); retry(); }
        });
      } catch (error) { if (!stopped) { onState("unavailable"); retry(error); } }
    };
    let failures = 0, retryTimer;
    const retry = error => {
      clearTimeout(retryTimer);
      const gateDeadline = Math.max(error?.retryAt ?? 0, gates[exchange]?.blockedUntil ?? 0);
      const cooldownDelay = gateDeadline - now();
      // Sleep through an exchange ban instead of polling it every 30 seconds.
      // Recheck on wake because another in-flight response can extend the ban.
      const delay = cooldownDelay > 0
        ? cooldownDelay + 1000 + Math.floor(Math.random() * 2000)
        : Math.min(900_000, 30_000 * 2 ** Math.min(failures++, 5)) + Math.floor(Math.random() * 3000);
      retryTimer = setTimeout(connect, delay); retryTimer.unref?.();
    };
    void connect();
    return { stop() { stopped = true; generation++; unsubscribeCooldown?.(); clearTimeout(retryTimer); dispose(); } };
  }
  return { start };
}
