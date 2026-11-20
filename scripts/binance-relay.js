#!/usr/bin/env node
// Minimal, authenticated Binance public-market-data relay.
//
// Run this on a small host in a region Binance serves (e.g. Render Frankfurt,
// Fly.io Amsterdam/Tokyo, a Hetzner/DigitalOcean EU or Asian VPS), then set on
// the main app:
//   BINANCE_RELAY_URL=https://your-relay.example.com
//   BINANCE_RELAY_KEY=<same long random secret as RELAY_KEY below>
//
// Relay environment:
//   RELAY_KEY   required, long random secret (e.g. `openssl rand -hex 32`)
//   PORT        listening port (default 8080)
//
// Only GET requests to Binance public market-data hosts are forwarded, and
// only WebSocket streams on Binance public stream hosts. It is NOT an open
// proxy, holds no Binance API keys and never forwards authenticated endpoints.
// Rate limits are still enforced by the main app's shared Binance gate.
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";

const KEY = process.env.RELAY_KEY ?? "";
const PORT = Number(process.env.PORT || 8080);
if (KEY.length < 24) {
  console.error("RELAY_KEY must be set to a random secret of at least 24 characters.");
  process.exit(1);
}

const REST_HOSTS = new Set(["fapi.binance.com", "dapi.binance.com", "api.binance.com"]);
const STREAM_HOSTS = new Set(["fstream.binance.com", "dstream.binance.com", "stream.binance.com:9443"]);
// Public market-data path prefixes only (no /fapi/v1/order, /sapi, listenKey…).
const PUBLIC_PATHS = [
  /^\/fapi\/v1\/(ping|time|exchangeInfo|depth|trades|aggTrades|klines|continuousKlines|markPriceKlines|premiumIndex|fundingRate|fundingInfo|ticker\/24hr|ticker\/price|ticker\/bookTicker|openInterest)$/,
  /^\/dapi\/v1\/(ping|time|exchangeInfo|depth|trades|aggTrades|klines|premiumIndex|fundingRate|fundingInfo|ticker\/24hr|ticker\/price|ticker\/bookTicker|openInterest)$/,
  /^\/futures\/data\/[A-Za-z]+$/,
  /^\/api\/v3\/(ping|time|exchangeInfo|depth|trades|aggTrades|klines|uiKlines|avgPrice|ticker\/24hr|ticker\/price|ticker\/bookTicker|ticker)$/,
];
const PASS_HEADERS = ["content-type", "retry-after", "x-mbx-used-weight", "x-mbx-used-weight-1m"];

const authorized = req => {
  const given = Buffer.from(String(req.headers["x-relay-key"] ?? ""));
  const expected = Buffer.from(KEY);
  return given.length === expected.length && timingSafeEqual(given, expected);
};
// "/fapi.binance.com/fapi/v1/klines?..." -> { host, path }
const split = rawUrl => {
  const url = new URL(rawUrl, "http://relay.local");
  const [, host, ...rest] = url.pathname.split("/");
  return { host: decodeURIComponent(host ?? ""), path: `/${rest.join("/")}`, search: url.search };
};

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") { res.writeHead(200, { "content-type": "text/plain" }).end("ok"); return; }
  if (!authorized(req)) { res.writeHead(401).end(); return; }
  if (req.method !== "GET") { res.writeHead(405).end(); return; }
  const { host, path, search } = split(req.url);
  if (!REST_HOSTS.has(host) || !PUBLIC_PATHS.some(rule => rule.test(path))) { res.writeHead(404).end(); return; }
  try {
    const upstream = await fetch(`https://${host}${path}${search}`, {
      headers: { "User-Agent": "Crypto-Orderflow-Relay/1.0" }, signal: AbortSignal.timeout(10_000),
    });
    const headers = {};
    for (const name of PASS_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    res.writeHead(upstream.status, headers);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ msg: "Relay upstream unavailable" }));
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4_000_000 });
server.on("upgrade", (req, socket, head) => {
  const { host, path, search } = split(req.url);
  if (!authorized(req) || !STREAM_HOSTS.has(host) || !/^\/(ws|stream|market\/ws|public\/ws)(\/.*)?$/.test(path)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, client => {
    const upstream = new WebSocket(`wss://${host}${path}${search}`, { handshakeTimeout: 12_000, maxPayload: 4_000_000 });
    const pending = [];
    upstream.on("open", () => { for (const message of pending.splice(0)) upstream.send(message); });
    upstream.on("message", (data, isBinary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary }); });
    upstream.on("ping", data => upstream.pong(data));
    upstream.on("unexpected-response", (_r, response) => { client.close(1011, `upstream ${response.statusCode}`); upstream.terminate(); });
    upstream.on("close", () => client.close());
    upstream.on("error", () => client.terminate());
    client.on("message", (data, isBinary) => {
      const message = isBinary ? data : data.toString();
      if (upstream.readyState === WebSocket.OPEN) upstream.send(message); else pending.push(message);
    });
    client.on("ping", data => client.pong(data));
    client.on("close", () => upstream.close());
    client.on("error", () => upstream.terminate());
  });
});

server.listen(PORT, "0.0.0.0", () => console.info(`Binance relay listening on ${PORT}`));
