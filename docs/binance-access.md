# Binance access from restricted hosting regions

## Symptom

All Binance sources (LSAR, OI, funding, CVD, candles) show unavailable while
Bybit/OKX/Gate keep working. `GET /api/healthz` lists the blocked hosts under
`binance.geoBlocked`.

## Cause

Binance refuses public market-data requests from its **restricted locations**,
which include the **United States**. It answers with **HTTP 451** ("Service
unavailable from a restricted location"), or for some futures hosts with a
CloudFront **403** ("configured to block access from your country"). Replit
Deployments and Render's default Oregon/Ohio/Virginia regions egress from US
IPs, so a deployed copy of this app is blocked even though it worked from a
developer machine in a supported country. This is not a rate limit or a ban
and retrying cannot succeed.

## What the app now does

1. **Spot public data** (CVD spot markets/trades) uses Binance's official
   market-data-only domains `data-api.binance.vision` and
   `data-stream.binance.vision`, which are not region-blocked. Set
   `BINANCE_SPOT_HOST=binance.com` to force the original hosts.
2. **451 / country-block 403 is recognized as a geo block.** The affected host
   (for example `fapi.binance.com`) is paused for 30 minutes and requests fail
   fast with a clear message, without spending Binance quota or escalating the
   shared ban backoff. Other Binance hosts (spot via binance.vision) continue.
3. **Futures through an optional relay.** USD-M/COIN-M futures
   (`fapi`, `dapi`, `fstream`, `dstream`) have no official unblocked mirror.
   When `BINANCE_RELAY_URL` is set, those REST calls and WebSocket streams go
   through a relay you run in a supported region. Rate-limit accounting still
   uses the original Binance URL and the shared Binance gate.

## Fix options (choose one)

### A. Host the app in a supported region (simplest, no relay)

Redeploy the whole app in a region Binance serves, e.g. **Render Frankfurt**
(or Singapore), Fly.io `fra`/`ams`/`nrt`, or an EU/Asian VPS. Replit
Deployments cannot choose a non-US region. No configuration is needed.

### B. Keep the current host and add a relay

1. Deploy `scripts/binance-relay.js` (same repository) on a small service in a
   supported region:
   - Start command: `node scripts/binance-relay.js`
   - Env: `RELAY_KEY=<random 32+ char secret>` (`openssl rand -hex 32`)
   - Health check: `/healthz`
2. On the main app set:
   - `BINANCE_RELAY_URL=https://<relay-host>`
   - `BINANCE_RELAY_KEY=<same secret>`
3. Restart the app; `GET /api/healthz` should show `"futures": "relay"` and an
   empty `geoBlocked` list after the next scan.

When a relay is configured, **all** Binance traffic (futures and spot, REST
and streams) uses it, so a banned or shared hosting IP is never used for
Binance. This also fixes HTTP 418 IP bans caused by other tenants of a shared
hosting IP (Render's outbound IPs are shared per region).

The relay forwards **only** GET requests to Binance public market-data paths
and public stream hosts, requires the shared secret, stores nothing and holds
no Binance API keys. It is not an open proxy.

## Compliance note

Binance's terms restrict use from its restricted locations. Hosting choice is
the operator's responsibility; this app only reads public market data.

## References

- Binance futures general info: https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info
- Binance developer forum, 451 from US: https://dev.binance.vision/t/error-451-when-accessing-the-futures-api-from-us/16725
