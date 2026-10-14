# Multi-Exchange Aggregated Funding Rate

Super Charts → Orderflow Indicators has an indicator selector. Liquidity Zones
remains intact; Aggregated Funding Rate adapts the user's uploaded Pine v6
script. It now shares the native Super Charts time axis with price, technical
studies and Liquidity Zones. There is no hosted TradingView widget or Pine runtime.

## Current values

- Simple Mean is the default, alongside Median and OI-Weighted.
- Neutral threshold defaults to ±0.08%. Positive values are red, negative green;
  threshold boundaries are dashed and zero is dotted.
- Quote percentages are normalized to a common 8-hour basis using each
  contract's verified current interval. Unknown intervals do not contribute.
- All **17 existing funding-provider adapters** are considered: Binance, Bybit,
  OKX, Gate.io, Bitget, MEXC, KuCoin, Kraken, BingX, Aster, Hyperliquid, HTX,
  Deribit, Lighter, Paradex, CoinEx and BitMEX. This is supported potential
  coverage, not a guarantee that every exchange lists or supplies every coin.
- This indicator uses all verified venues for the selected coin; the Funding
  Rate screener's global 1% OI exchange cutoff remains unchanged.
- One highest-OI verified perpetual contract per exchange contributes, avoiding
  multiple listings biasing a simple mean. Symbols and last-received timestamps
  are exposed. Multipliers and XBT/XDG aliases resolve to underlying identity.
- OI weights use the existing adapters' verified USD values. Negative/missing
  weights are zero. As in Pine, if no positive weights exist, weighted mode
  explicitly falls back to the simple mean. Mean/median never require OI weights.
- Quotes over 15 minutes old, invalid rates and unverified intervals are missing,
  never literal zero funding. A genuine zero remains a valid value.

## History choice approved by the user

Live quotes support all three aggregation methods. Historical mean/median charts
use actual settled funding-payment records. Historical OI-weighted charts are
**not synthesized using today's OI**: OI-Weighted selects recorded live snapshots.
Switching aggregation methods or threshold is local, without new provider calls.

Settled history is **not a historical funding forecast series** from TradingView.
For each pair of successive payments, the actual observed spacing establishes
the payment interval; its paid percentage is scaled to an effective 8-hour rate.
The first payment cannot infer an interval and is not invented. Supported observed
intervals range from 15 minutes to 24 hours. Irregular/unknown intervals are
excluded. There is no independent guarantee that an exchange's nominally complete
API history contains every payment; frequency inferred from missing records can
still be inaccurate. This is disclosed rather than claiming TradingView parity.

At each selected UTC chart interval, the last known settled rate may carry forward
for at most one inferred payment period (+1 minute timestamp tolerance), then
becomes missing. The chart preserves gaps. This is not a cumulative payment
return, nor a forecast of what will settle next.

Windows are 24 hours, 7 days and 30 days, with 5m/15m/30m/1h/4h/1D chart intervals.
Two days of preceding payments are requested to infer initial periods. Partial
venue histories are labelled partial; BitMEX, Lighter, Paradex and CoinEx have
live coverage when valid but no verified settled-history adapter here. Other
unavailable or incomplete sources remain visible, without fabricated values.

## Recorded live observations

Live snapshots store the actual mean, median, contemporaneous USD-OI weighted
rate, fallback status and participating count. Observations start when this asset
is tracked and cannot be backfilled with invented values. A bounded tracker
samples every 30 seconds into minute buckets while a recently viewed asset is
active. It stops tracking assets unseen for 45 minutes, with at most ten active
assets and twenty cached series.

Up to seven days / 10,080 minute snapshots are retained. Local JSON under ignored
`.cache/funding-indicator/` is saved atomically no more than once per minute.
There is no database or durable hosted storage promise: Render's ephemeral
filesystem may discard this cache on redeploy or restart. Missing tracking
periods appear as chart gaps.

## Request and cache protections

- `/api/indicators/funding` reads the same shared funding/OI inventory as existing
  screeners; it does not start an independent current-market collector.
- Existing IP-wide request gates, provider retries and cooldowns stay in force.
- At most eight settled-history jobs are in flight, coalesced by exchange/contract.
  History retries are held for at least five minutes, longer during cooldowns.
- Cached payments from the existing Funding Rate module are reused when available.
  Successful complete histories fetch only the newer missing interval; larger
  window selections can expand history safely. Caches are bounded.
- Source collection/history load progressively; the UI polls at 10 seconds while
  warming up or 30 seconds when settled, only after each response completes.
- Refresh does not bypass any exchange cache, shared gate or ban.

Relevant code: `server/fundingIndicator.js`, `server/fundingIndicatorMath.js`,
`server/fundingHistory.js`, `src/components/aggregated-funding-indicator.tsx`,
`src/components/funding-indicator-chart.tsx`.
