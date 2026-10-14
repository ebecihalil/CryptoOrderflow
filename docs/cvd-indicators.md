# Aggregated executed-trade CVD

Super Charts has independent **Perpetual CVD** and **Spot CVD** selections in
Orderflow Indicators. Both coexist with technical studies, funding and Liquidity
Zones on the existing native chart. Each defaults to a **one-week calendar
anchor** and can separately use 1D, 1W, 1M, 3M, 6M or 1Y. Weeks start Monday;
quarters start January/April/July/October, all UTC. Chart resolution is separate.

## Meaning and units

CVD = cumulative **taker-buy executed value − taker-sell executed value**.
Sum venue observations directly; **never OI-weight CVD**. Values are
USD-equivalent, with USD/USDT/USDC treated at parity. This is not an FX-adjusted
dollar total. Spot and perpetual executions never mix.

One verified liquid quote market per exchange is used, preferentially USDT
(Kraken prefers USD). The implementation covers stablecoin/USD spot and linear
perpetuals, not every alternative quote pair, delivery or inverse contract.
Canonical multiplier assets match across venues; native price × native quantity
already cancels bundle scaling. Contracts expressed in lots use verified
underlying contract sizes (OKX, Gate, MEXC, KuCoin, HTX). Kraken PF linear
contracts use the metadata contract size. Taker side comes from documented trade
fields, not price direction, OHLC, position changes or maker flags used backwards.

Public feed adapters exist for Binance, Bybit, OKX, Gate, MEXC, Bitget, BingX,
KuCoin, Kraken and HTX, for both markets. Source status is live only after a valid
execution arrives. Missing markets, denied connections and unrecognized data
remain unavailable/idle; they never become invented zero contributions.

## History and precision

The initial release collects real streams on demand and reloads its own verified
local recordings. **One week is sufficient; there is no three-month history
requirement or fabricated backfill.** Actual history start, source participation
and partial-anchor status are visible. Longer anchor selections do not imply that
full history is available. At most 1,500 CVD chart bars are returned; compact minute
recordings retain up to 14 days, covering the previous and current calendar week.

Trades are reordered by provider timestamp for 2.5 seconds, then applied in
sequence to produce relative minute OHLC. Higher-timeframe candles concatenate
those paths; per-exchange extrema are not summed. Cross-venue clocks and tied
timestamps are not an exact global matching-engine sequence. Extremely late
executions and safety-buffer overflow are explicitly disclosed as incomplete
coverage; data is never claimed complete. Coverage changes/downtime reset the
observed segment. Unknown intervals are not zero-filled. Binance, most other
venues and MEXC protobuf execution IDs are deduplicated without numeric rounding.
BingX perpetual frames lack execution IDs: unique received records are retained,
including identical legitimate fills; undocumented upstream replays cannot be
exactly deduplicated. Pre-subscription snapshots are excluded.

## Operations

`GET /api/indicators/cvd?asset=BTC&market=spot&timeframe=1h&anchor=1w`
returns a cached collector snapshot, not fresh REST trade requests. All viewers
of one asset/market share the same upstream collectors, irrespective of TF/anchor.
Browser polling stops when its indicator is disabled. Collectors stop after 30
idle minutes or earlier under capacity pressure; four asset/market groups are
bounded concurrently. Recently polled groups are not evicted. Capacity exhaustion
returns an explicit retryable error instead of false data.

Atomic compressed minute recordings are in ignored `.cache/cvd-recordings/`.
Graceful shutdown flushes recorded data. This is **local**, not guaranteed durable
on Render's ephemeral filesystem or across deployment replacement. Persistent
storage and scheduled collection require separate hosting configuration.
Persistence errors are disclosed. No API keys or private account feeds are used.

## Provider references / verified format details

- Binance: [routed streams](https://developers.binance.com/legacy-docs/derivatives/usds-margined-futures/websocket-market-streams).
  USD-M aggTrade must use `/market/ws`; unrouted `/ws` may accept subscriptions
  but silently provide no trades following the March 2026 migration.
- Bybit: [public trades](https://bybit-exchange.github.io/docs/v5/websocket/public/trade).
- OKX: [API docs](https://www.okx.com/docs-v5/en/), public `trades`.
- Gate: [futures WS](https://www.gate.com/docs/developers/futures/ws/en/).
  `X-Gate-Size-Decimal: 1` is required to preserve fractional lots.
- MEXC: [spot protobuf trade stream](https://www.mexc.com/api-docs/spot-v3/websocket-market-streams/trade-streams)
  and [futures deal stream](https://www.mexc.com/api-docs/futures/websocket-api/deal).
  Actual uncompressed futures pushes use a singleton data object; both singleton
  and batched payloads are supported.
- Bitget: public v2 `trade`, SPOT/USDT-FUTURES, object records.
- BingX: [API docs](https://bingx-api.github.io/docs-v3/), gzip trade records;
  perpetual endpoint `open-api-swap.bingx.com/swap-market`.
- KuCoin: public bullet-issued connection tokens; `/market/match` and
  `/contractMarket/execution`. Tokens are not logged or stored in recordings.
- Kraken: [spot](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/trade)
  and [futures](https://docs.kraken.com/exchange/api-reference/futures-websocket/trade).
- HTX: [linear swap](https://huobiapi.github.io/docs/usdt_swap/v1/en/);
  gzip `trade.detail`, quoted turnover/coin quantity distinct from contract lots.
