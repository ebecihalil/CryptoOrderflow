import { gunzipSync } from "node:zlib";
import protobuf from "protobufjs";

// Minimal projection of the provider's official protobuf schema:
// github.com/mexcdevelop/websocket-proto/{PushDataV3ApiWrapper,PublicAggreDealsV3Api}.proto
export const mexcTradeType = protobuf.parse(`syntax="proto3";
message Deal { string price=1; string quantity=2; int32 tradeType=3; int64 time=4; string tradeId=5; }
message Deals { repeated Deal deals=1; string eventType=2; }
message Wrapper { string channel=1; string symbol=3; int64 createTime=5; int64 sendTime=6; Deals publicAggreDeals=314; }
`).root.lookupType("Wrapper");

export function decodeTradeMessage(exchange, market, raw) {
  if (typeof raw === "object" && !Buffer.isBuffer(raw) && !(raw instanceof ArrayBuffer)) return raw;
  let bytes = Buffer.isBuffer(raw) ? raw : raw instanceof ArrayBuffer ? Buffer.from(raw) : null;
  if (bytes?.[0] === 31 && bytes[1] === 139) bytes = gunzipSync(bytes, { maxOutputLength: 4_000_000 });
  if (exchange === "mexc" && market === "spot" && bytes && bytes[0] !== 123) {
    return mexcTradeType.toObject(mexcTradeType.decode(bytes), { longs: String });
  }
  const text = bytes ? bytes.toString("utf8") : String(raw);
  if (["ping", "pong", "Ping", "Pong"].includes(text)) return { heartbeat: text };
  // Node 24 exposes the original primitive source to JSON revivers. Keep large
  // execution IDs exact; rounding two IDs together would silently lose trades.
  return JSON.parse(text, (_key, value, context) =>
    typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)
      ? context.source : value);
}
function milliseconds(value) {
  if (typeof value === "string" && value.includes("T")) return Date.parse(value);
  let n = Number(value);
  if (n > 1e17) n /= 1e6;
  else if (n < 1e11) n *= 1000;
  return Math.floor(n);
}
const sideNumber = value => value === 1 || value === "1" ? "buy" : value === 2 || value === "2" ? "sell" : null;
const makerSide = maker => typeof maker === "boolean" ? maker ? "sell" : "buy" : null;

export function parseCvdTrades(exchange, market, message, instrument, frameId = "") {
  let rows = [], transform;
  switch (exchange) {
    case "binance":
      if (message.e !== "aggTrade" || message.s !== instrument.symbol) break;
      rows = [message]; transform = r => [r.a, r.T, makerSide(r.m), r.p, r.q, 1]; break;
    case "bybit":
      if (message.topic !== `publicTrade.${instrument.symbol}`) break;
      rows = message.data ?? []; transform = r => [r.i, r.T, r.S?.toLowerCase(), r.p, r.v, 1]; break;
    case "okx":
      if (message.arg?.channel !== "trades" || message.arg.instId !== instrument.symbol) break;
      rows = message.data ?? []; transform = r => [r.tradeId, r.ts, r.side, r.px, r.sz, market === "spot" ? 1 : instrument.contractSize]; break;
    case "gate":
      if (message.channel !== (market === "spot" ? "spot.trades" : "futures.trades") || message.event !== "update") break;
      rows = Array.isArray(message.result) ? message.result : [message.result];
      transform = r => r?.[market === "spot" ? "currency_pair" : "contract"] !== instrument.symbol ? null :
        [r.id, r.create_time_ms ?? r.create_time, market === "spot" ? r.side : Number(r.size) > 0 ? "buy" : Number(r.size) < 0 ? "sell" : null,
          r.price, market === "spot" ? r.amount : Math.abs(Number(r.size)), market === "spot" ? 1 : instrument.contractSize]; break;
    case "mexc":
      if (market === "spot") {
        if (message.symbol !== instrument.symbol) break;
        rows = message.publicAggreDeals?.deals ?? [];
        transform = r => [r.tradeId, r.time, sideNumber(r.tradeType), r.price, r.quantity, 1];
      } else {
        if (message.channel !== "push.deal" || message.symbol !== instrument.symbol) break;
        rows = Array.isArray(message.data) ? message.data : message.data ? [message.data] : [];
        transform = r => [r.i, r.cts ?? r.t, sideNumber(r.T), r.p, r.v, instrument.contractSize];
      } break;
    case "bitget":
      if (message.arg?.channel !== "trade" || message.arg.instId !== instrument.symbol) break;
      rows = message.data ?? []; transform = r => [r.tradeId, r.ts, r.side, r.price, r.size, 1]; break;
    case "bingx": {
      const r = message.data;
      if (!r || message.dataType !== `${instrument.symbol}@trade`) break;
      rows = Array.isArray(r) ? r : [r];
      // BingX perpetual trade frames omit execution IDs. Transport-local IDs
      // preserve identical legitimate fills instead of hash-deduplicating them.
      transform = (t, index) => [t.t ?? t.tradeId ?? (frameId ? `${frameId}:${index}` : undefined),
        t.T ?? t.E, makerSide(t.m), t.p, t.q, 1]; break;
    }
    case "kucoin":
      if (message.type !== "message" || message.topic !== `${market === "spot" ? "/market/match" : "/contractMarket/execution"}:${instrument.symbol}`) break;
      rows = [message.data]; transform = r => [r.tradeId, r.time ?? r.ts, r.side, r.price, r.size, market === "spot" ? 1 : instrument.contractSize]; break;
    case "kraken":
      if (market === "spot") {
        if (message.channel !== "trade" || message.type !== "update") break;
        rows = (message.data ?? []).filter(r => r.symbol === instrument.symbol);
        transform = r => [r.trade_id, r.timestamp, r.side, r.price, r.qty, 1];
      } else {
        if (message.feed !== "trade" || message.product_id !== instrument.symbol || message.type === "block") break;
        rows = [message]; transform = r => [r.uid, r.time, r.side, r.price, r.qty, instrument.contractSize];
      } break;
    case "htx":
      if (message.ch !== `market.${instrument.symbol}.trade.detail`) break;
      rows = message.tick?.data ?? [];
      // HTX linear swap's amount is contracts, quantity is underlying coins.
      transform = r => [r.id ?? r.tradeId, r.ts, r.direction, r.price,
        market === "perpetual" && r.quantity !== undefined ? r.quantity : r.amount,
        market === "spot" || r.quantity !== undefined ? 1 : instrument.contractSize]; break;
  }
  if (!Array.isArray(rows) || !transform) return [];
  const trades = [];
  for (const [index, row] of rows.entries()) {
    const fields = row && transform(row, index);
    if (!fields) continue;
    const [id, timestamp, side, rawPrice, rawQuantity, multiplier] = fields;
    const price = Number(rawPrice), quantity = Number(rawQuantity), time = milliseconds(timestamp);
    const value = price * quantity * multiplier;
    const divisor = instrument.priceDivisor ?? 1;
    if (id === undefined || id === null || !["buy", "sell"].includes(side) ||
      !(price > 0 && quantity > 0 && value > 0 && Number.isFinite(value)) ||
      !(divisor > 0 && Number.isFinite(divisor)) || !Number.isSafeInteger(time) || time <= 0) continue;
    trades.push({ id: String(id), exchange, symbol: instrument.symbol, time, side, value,
      price: price / divisor, quantity: quantity * multiplier * divisor });
  }
  return trades;
}
