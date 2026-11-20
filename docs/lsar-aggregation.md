# LSAR aggregation

Current aggregated LSAR and every timeframe comparison use **OI-weighted account
shares first**, rather than an arithmetic OI-weighted mean of raw ratios.

For each usable source with reported long/short account ratio `R` and USD open
interest `W`:

- Long-account share: `L = R / (1 + R)`.
- Short-account share: `S = 1 / (1 + R)`.
- Aggregate long share: `sum(W * L) / sum(W)`.
- Aggregate short share: `sum(W * S) / sum(W)`.
- Aggregate LSAR: `sum(W * L) / sum(W * S)`.

The displayed long percentage is the weighted long share. Individual exchange
ratios, USD OI conversions, price weighting, multipliers and source filters are
unchanged. A lone source retains its exact reported ratio. A venue with genuinely
large OI among contributors can still dominate; an extreme raw ratio alone no
longer has unbounded arithmetic influence.

## Timeframe changes
Compare the latest observation in the current candle with the latest observation
in the immediately previous candle. Both reconstructed ratios use the same
matched contracts and identical current USD OI weights. Invalid/missing
observations or weights exclude a contract from **both** sides.

The main change remains ratio-relative percent:
`(current reconstructed LSAR / previous reconstructed LSAR - 1) * 100`.
The secondary change remains long-share **percentage points**, not a second
ratio-relative percent. This update does not turn candle comparisons into a
rolling-window comparison.

## Interpretation
This is a synthetic OI-weighted account-positioning index. It does not reconstruct
the pooled count of long/short accounts, because venue account counts are not
available. Account ratios do not identify retail versus institutions or reveal
position sizes. OI shares refer to the usable contributing contracts, not
automatically every exchange in the market.

## Requests and numerical handling
The LSAR page requests `maxPrice=all`; there is no maximum-price control or
hidden $5 cap in the screener. Crypto-only identity checks still apply.
Source status displays exchange logos, names, counts and signals, without
ban/rate-limit prose. Removing that prose does not remove server cooldowns.

This is a calculation-only change: it introduces no new exchange requests or
changes to rate limits. OI weights are normalized by the largest weight to avoid
overflow. Short shares are accumulated directly, not obtained by subtracting
the long share from one near 100%. Missing data does not become zero.

## Top Trader LSAR

`/top-trader-long-short-account-ratio` (API: `/api/market/lsar?kind=top`,
`/api/market/summary?kind=top`) runs a second collector with identical
aggregation and candle comparisons, using each exchange's **top-trader account
ratio**:

| Exchange | Source | Extra requests |
| --- | --- | --- |
| Binance USD-M | `/futures/data/topLongShortAccountRatio?symbol=` | 1 per contract |
| Binance COIN-M | `/futures/data/topLongShortAccountRatio?pair=&contractType=PERPETUAL` | 1 per contract |
| OKX | `rubik/stat/contracts/long-short-account-ratio-contract-top-trader` (5m + 1H) | 2 per contract |
| Gate.io | `contract_stats.top_lsr_account` from the global scan's response | none |

Contracts, prices and USD OI weights are reused from the Global LSAR scan for
the same contracts, so both screens weight venues identically. Bybit and Toobit
publish no top-trader ratio; Bitget and HTX are excluded until their endpoints
are verified against official documentation. Each exchange defines "top
traders" differently (Binance: top 20% by margin balance), so the aggregate is
a cross-venue proxy, not one uniform population. Binance futures-data budgets
are per endpoint, so the top-trader scan does not slow the global scan.
