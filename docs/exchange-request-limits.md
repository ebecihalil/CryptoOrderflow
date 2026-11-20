# Exchange request safety

Reviewed against official sources on **2026-10-13**. Applies to the public
market-data endpoints this screener actually uses, not trading/order quotas.
Limits can change; recheck before adding endpoints or increasing throughput.

| Exchange | Published rule relevant to this app | App allowance |
| --- | --- | --- |
| Binance | General futures routes: **2,400 weight / minute / IP**. `/futures/data/*` history: **1,000 requests / 5 minutes / IP** per endpoint (each endpoint counted separately; USD-M and COIN-M share one count here). Exceeding limits gives 429; continuing gives an automated **418 IP ban (2 minutes up to 3 days)**, longer for repeat offenders. | Budgets assume the hosting IP may be **shared with other tenants** (Render's outbound IPs are). General requests: **400 weight / minute** (~17%). Each `/futures/data` endpoint: **450 / rolling 5 minutes** (~45% of its quota). Funding history: 200 / 5 minutes. At least 150 ms apart. Pause 60 s when Binance reports the IP's used weight ≥ **600**. **Probe mode:** after every process start and every pause, exactly one request is sent; nothing else is admitted until Binance answers normally. |
| Bybit | General public HTTP ceiling **600 requests / 5 seconds / IP**; endpoint quotas and `X-Bapi-*` headers also apply. HTTP 403 "access too frequent": stop all sessions and wait **at least 10 minutes**. JSON `10006` is a rate limit; `10009` an IP ban. | **30 calls / rolling 5 seconds**, at least 160 ms apart. Entire provider pauses for rate errors; 403/IP-ban fallback at least **15 minutes**. |
| OKX | Contract account ratio: **5 calls / 2 seconds / IP + instrument ID**. Public instruments and open interest: 20 / 2 seconds; tickers: 20 / 2 seconds. JSON `50011` can report throttling with HTTP 200. | All used routes and instruments together: **6 calls / rolling 2 seconds** (30% of the 20 / 2 s public ceiling), at least 300 ms apart. Each instrument's account-ratio endpoints are hit only 2–4 times per refresh, far below 5 / 2 s per instrument. Detect JSON and HTTP rate errors. |
| Gate.io | Published futures public endpoint allowance **200 calls / 10 seconds / endpoint / IP**. | All used public routes together: **80 calls / rolling 10 seconds**, at least 150 ms apart. Respect quota/reset headers and HTTP 429. |
| Bitget | Classic `/api/v2/mix/market/account-long-short`: **1 request / second / IP**, not one per coin or timeframe. Public metadata/ticker endpoints have separate limits. | Account-ratio calls **at least 1,251 ms apart** (rolling 1-call / 1,250-ms window). All used routes additionally limited to **8 calls / second**, at least 150 ms apart. |
| Toobit | General REST allowance **3,000 weight / minute**; `X-Api-Limit-*` headers report allowance and reset. The LSAR page does **not** publish its individual weight or a numeric endpoint-specific ceiling. Do not infer an exact LSAR quota from the general weight limit. | Conservative **50 total calls / rolling minute**, at least 1,100 ms apart; observe remaining allowance and reset headers. This is a precaution, **not proof of an unpublished endpoint limit**. |

## Enforcement

- Every outbound request, including network/server-error retries, passes through
  its exchange's admission queue before its network timeout starts.
- Rolling budgets and spacing prevent bursts, including simultaneous per-coin
  workers, multiple timeframes, and both Binance products.
- HTTP 429/418/403 immediately pauses the whole affected exchange. Queued calls
  recheck the pause before admission. Already-issued calls cannot be unsent.
- Rate-limit JSON codes are recognized even when HTTP is 200. No immediate retry
  on rate errors. Explicit retry/reset times are respected; missing guidance uses
  increasing cooldowns. Bybit's minimum ban wait is also enforced.
- Successful responses showing almost-exhausted quotas delay subsequent calls.
- Binance ban timestamps are parsed without returning the server IP to clients.
- Existing shared snapshots, five-minute scan scheduling, no-overlap protection,
  progressive delivery and 15-minute freshness exclusions remain unchanged.
  Safer pacing means full scans can take longer, particularly Bitget/Toobit;
  all supported contracts are still queued, not silently removed.
- No changes to LSAR candle calculations, OI weighting, filters or UI.

- Binance HTTP 451 (restricted location) and CloudFront country-block 403 are
  geographic blocks, not rate limits. They pause only the affected Binance host
  for 30 minutes without escalating ban backoff. See `binance-access.md`.
- The Leverage Estimate's per-asset history calls (Binance futures/data,
  OKX rubik, Gate contract_stats, Bybit OI/account-ratio, spot candles) use the
  same shared gates. See `leverage-estimate.md`.

- Visitor actions (Refresh buttons, switching coin/timeframe) only read
  cached server snapshots: LSAR scans run at most every 5 minutes, chart
  candles cache 30 s per market (max 4 in flight), leverage history refreshes
  every 2–5 minutes, metadata hourly. Any extra demand queues behind the
  shared gate; it can never raise the request rate above the budgets above.
  `server/binanceBanSafety.test.js` verifies this with a 1,500-request flood.
- Why probe mode exists: Render (and similar hosts) wipe `.cache/` on every
  restart and free instances restart on each wake, so a saved ban deadline is
  lost. Without probing, a restart would send a burst into a live ban and
  Binance escalates ban length for that.

## Persistence and hosting constraints

Request windows, cooldowns and fallback-backoff levels are saved atomically to
`.cache/exchange-request-state.json`. Failure to load/save valid limiter state
fails explicitly instead of allowing untracked requests. No credentials or IP
addresses are stored. The file is excluded from Git and deployment bundles.

This is a **single-collector-process** design. Other apps sharing an outgoing IP
can consume the same exchange allowance. Multiple server instances need a shared
atomic limiter, not independent local files. Do not scale collectors independently.
Local state survives a process restart **only when the filesystem is retained**.
A Render redeployment or ephemeral-host replacement can discard it; cross-deploy
persistence requires durable storage. This code cannot lift an existing IP ban
and cannot guarantee that an exchange never blocks a hosting IP.

## Official references

- [Binance account ratio](https://developers.binance.com/legacy-docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio)
- [Binance futures general limits/bans](https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info)
- [Bybit limits and response headers](https://bybit-exchange.github.io/docs/v5/rate-limit)
- [OKX contract account ratio](https://www.okx.com/docs-v5/en/#trading-statistics-rest-api-get-contract-long-short-ratio)
- [Gate public endpoint limits](https://www.gate.com/announcements/article/33995)
- [Bitget classic account ratio](https://www.bitget.com/api-doc/classic/common/apidata/Account-Long-Short)
- [Toobit general rules and headers](https://api-docs.toobit.com/api/basic-information.html)
- [Toobit market endpoints](https://api-docs.toobit.com/api/usdt-m-market-data)

Documentation routing caveat: some non-legacy Binance paths now redirect to a
combined reference, and Bitget's classic paths may redirect to its introduction.
Binance's legacy reference exposes the numeric history rule. Bitget's classic
official search-index entry states the 1-request/second rule; this rule is also
consistent with its currently documented UTA account-ratio endpoint, but this app
continues to use the classic endpoint, not UTA.

## Public CVD streaming

CVD does not continuously poll recent-trade REST endpoints. Market catalogues are
coalesced and cached for an hour (failed lookups for five minutes) through the
existing shared exchange HTTP gates. Spot Binance exchangeInfo reserves its
20-unit weight. New spot REST hostnames map to the same gates as their derivatives
counterparts. KuCoin public connection-token POSTs also use its shared limiter.

All CVD asset/market collectors share per-venue connection admission: at least two
seconds between starts, maximum four active asset/market cohorts (40 sockets),
on-demand only. Repeated browser refreshes reuse them. Heartbeats are typically
20 seconds (KuCoin uses its advertised interval), one subscription per socket.
Retries use 30-second exponential backoff capped at 15 minutes plus jitter;
existing persisted HTTP cooldowns prohibit new connects. Handshake 429/403/418
responses enter the shared cooldown handling. There is no proxy/IP rotation or
cooldown bypass. Rotate 24-hour-limited streams early and disclose the gap.
These conservative application bounds do not guarantee a provider will never
restrict a shared hosting IP. Current source failures remain visible.
