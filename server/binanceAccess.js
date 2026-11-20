// Binance refuses public market-data requests from "restricted locations"
// (HTTP 451), which includes the United States and therefore most default
// US hosting regions (Replit Deployments, Render Oregon/Ohio/Virginia,
// Vercel/AWS us-*). See docs/binance-access.md.
//
// Two independent, dependency-free remedies are applied here:
//  1. Spot public market data uses Binance's official market-data-only
//     domains (data-api.binance.vision / data-stream.binance.vision).
//  2. Futures (fapi/dapi/fstream/dstream) have no such mirror. When
//     BINANCE_RELAY_URL is set, those requests are forwarded through a relay
//     the owner runs in a Binance-supported region (scripts/binance-relay.js).
//
// Rate-limit accounting always uses the ORIGINAL binance.com URL, so the shared
// Binance gate keeps one budget regardless of the route taken.

const SPOT_REST = "api.binance.com";
const SPOT_DATA_REST = "data-api.binance.vision";
const SPOT_STREAM = "stream.binance.com:9443";
const SPOT_DATA_STREAM = "data-stream.binance.vision";
export const RELAY_REST_HOSTS = new Set(["fapi.binance.com", "dapi.binance.com", "api.binance.com"]);
export const RELAY_STREAM_HOSTS = new Set(["fstream.binance.com", "dstream.binance.com", "stream.binance.com:9443"]);

export function binanceAccessConfig(env = process.env) {
  const relay = String(env.BINANCE_RELAY_URL ?? "").trim().replace(/\/+$/, "");
  let relayUrl = null;
  if (relay) {
    const parsed = new URL(relay); // Invalid configuration should fail loudly at startup.
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("BINANCE_RELAY_URL must be an http(s) URL.");
    relayUrl = parsed.toString().replace(/\/+$/, "");
  }
  return {
    relayUrl,
    relayKey: String(env.BINANCE_RELAY_KEY ?? ""),
    // "binance.vision" (default) or "binance.com" to force the original spot host.
    spotHost: env.BINANCE_SPOT_HOST === "binance.com" ? "binance.com" : "binance.vision",
  };
}

const defaultConfig = binanceAccessConfig();

/** Returns { url, headers } to actually request for an original Binance REST URL. */
export function routeBinanceRequest(value, config = defaultConfig) {
  const url = new URL(value);
  // With a relay, ALL Binance traffic (spot too) leaves from the relay's own
  // IP, so a banned/shared hosting IP is never used for Binance at all.
  if (config.relayUrl && RELAY_REST_HOSTS.has(url.host)) {
    return {
      url: `${config.relayUrl}/${url.host}${url.pathname}${url.search}`,
      headers: config.relayKey ? { "x-relay-key": config.relayKey } : {},
    };
  }
  if (url.host === SPOT_REST && config.spotHost === "binance.vision" && url.pathname.startsWith("/api/v3/")) {
    url.host = SPOT_DATA_REST;
    return { url: url.toString(), headers: {} };
  }
  return { url: url.toString(), headers: {} };
}

/** Returns { url, headers } for an original Binance WebSocket URL. */
export function routeBinanceSocket(value, config = defaultConfig) {
  const url = new URL(value);
  if (config.relayUrl && RELAY_STREAM_HOSTS.has(url.host)) {
    const base = config.relayUrl.replace(/^http/, "ws");
    return {
      url: `${base}/${url.host}${url.pathname}${url.search}`,
      headers: config.relayKey ? { "x-relay-key": config.relayKey } : {},
    };
  }
  if (url.host === SPOT_STREAM && config.spotHost === "binance.vision") {
    url.host = SPOT_DATA_STREAM;
    url.port = "";
    return { url: url.toString(), headers: {} };
  }
  return { url: url.toString(), headers: {} };
}

export function describeBinanceAccess(config = defaultConfig) {
  return {
    spot: config.spotHost === "binance.vision" ? "data-api.binance.vision" : "api.binance.com",
    futures: config.relayUrl ? "relay" : "direct",
    ...(config.relayUrl ? { spotVia: "relay" } : {}),
  };
}

// ---------- Host-scoped geographic block memory ----------
// A 451 on fapi.binance.com must not pause spot data that is still reachable
// through binance.vision, so geo blocks are remembered per original host rather
// than tripping the shared Binance rate-limit cooldown. Requests to a blocked
// host fail fast without touching the network until the pause expires.
export const GEO_BLOCK_PAUSE_MS = 30 * 60_000;

export class BinanceGeoBlockError extends Error {
  constructor(host, retryAt) {
    super(`Binance HTTP 451: Binance refuses ${host} requests from this server's location (restricted region). ` +
      `Set BINANCE_RELAY_URL or host the app in a supported region — see docs/binance-access.md. Next check ${new Date(retryAt).toISOString()}.`);
    this.name = "BinanceGeoBlockError";
    Object.assign(this, { host, retryAt, status: 451, retryable: false });
  }
}

export function createGeoBlockRegistry({ now = Date.now, pauseMs = GEO_BLOCK_PAUSE_MS } = {}) {
  const blocked = new Map();
  const hostOf = value => new URL(value).host;
  return {
    check(value) {
      const host = hostOf(value), until = blocked.get(host) ?? 0;
      if (now() < until) throw new BinanceGeoBlockError(host, until);
    },
    mark(value) {
      const host = hostOf(value), until = now() + pauseMs;
      blocked.set(host, until);
      return new BinanceGeoBlockError(host, until);
    },
    blockedUntil(value) { return blocked.get(hostOf(value)) ?? 0; },
    status() {
      return [...blocked].filter(([, until]) => until > now())
        .map(([host, until]) => ({ host, until: new Date(until).toISOString() }));
    },
  };
}

export const binanceGeoBlocks = createGeoBlockRegistry();
