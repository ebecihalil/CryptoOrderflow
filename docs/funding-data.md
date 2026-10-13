# Funding Rate data and coverage

The `/funding-rate` page is a separate module and does not change LSAR calculations.
Neither page is price-capped: BTC/ETH/SOL/HYPE are intentionally available.

## Comparison rules

- Each exchange is considered against **1% of total USD OI observed across the
  fetched perpetual inventory**, before coin search or exchange UI filters.
- This is not a CoinGlass/global-market census. Missing, blocked, unsupported or
  stale inventories are not silently estimated. While inventories fill, the
  denominator and qualifying exchanges can change.
- A qualifying exchange also needs a usable funding quote and its actual quote
  interval to contribute to a current aggregate.
- Current rates compare on an 8h-equivalent basis: native percent × 8 / interval
  hours. Native rates and observed intervals remain visible.
- BTC/ETH/SOL/HYPE summaries and aggregate columns are weighted by USD OI.
- Multiplier-prefixed contract identities are merged; the display symbol uses
  the most common spelling across contributing venues.
- Historical TFs are **sums of actual settled payments**, not annualized current
  rates. Windows are (start, end], ending at the latest full UTC hour.
- Historical aggregates use **current OI weights**, not an invented historical
  OI time series, and only venues with complete requested payment history.
- Unknown values remain unavailable, including unknown funding intervals.

## Inventories and current funding

| Venue | Public endpoints | Interval/OI basis |
|---|---|---|
| Binance | fapi/dapi exchangeInfo, premiumIndex, fundingInfo, openInterest | Adjusted fundingInfo intervals, documented 8h default otherwise; linear base OI × mark, inverse contracts × USD face value |
| Bybit | v5 market/tickers, linear + inverse | fundingIntervalHour; singleOpenInterestValue for linear USD OI, singleOpenInterest for inverse USD contracts; fallback halves documented both-sided fields |
| OKX | instruments, open-interest, funding-rate | oiUsd; nextFundingTime − fundingTime |
| Gate | futures/usdt and futures/btc contracts | Contract multiplier and direct/inverse USD conversion; funding_interval seconds |
| Bitget | mix/market/tickers + current-fund-rate, three product types | holdingAmount × markPrice; fundingRateInterval |
| MEXC | contract/detail, ticker, funding_rate/{symbol} | holdVol × contractSize × price for linear; USD contract face value for inverse; collectCycle |
| KuCoin | contracts/active | Contract multiplier and direct/inverse conversion; currentFundingRateGranularity |
| Kraken | derivatives tickers | Linear base OI × mark; inverse USD OI; relative hourly funding |
| BingX | premiumIndex + per-symbol openInterest | Reported USD OI; fundingIntervalHours |
| Hyperliquid | public POST info/metaAndAssetCtxs | Base OI × markPx; hourly funding, primary perp universe |
| HTX | linear swap metadata, batch funding, open interest | Reported USD value; settlement_period |
| Deribit | book summaries for BTC/ETH/USDC | Inverse USD vs linear base OI; current_funding is an 8h quote, continuously settled |

Aster is additionally attempted through its published fapi fundingInfo/quotes/
OI APIs. Lighter and Paradex public inventories are measured, but their funding
quote bases are **not assumed**; they cannot contribute a funding value until
those definitions are verified. Lighter's funding comparison feed contains other
exchanges' data, which must not be counted as Lighter's own quote.

CoinEx and BitMEX are attempted but unusable responses/unsupported USD conversion
are surfaced as errors rather than manufactured OI. Smaller measured venues are
excluded by the 1% rule. This is deliberately not a promise of 17 valid funding
feeds or of every venue qualifying at all times.

## History and refresh

Native history APIs are paginated safely, deduplicated by payment timestamp and
filtered to the requested window. OKX exposes only approximately three months:
its 1 Year values are unavailable. Other venues can also lack the beginning of a
window; those are unavailable rather than partial totals labeled as complete.
New listings are allowed when their known launch time proves no earlier payments
are missing.

Backfill happens only when a historical TF is requested, with two jobs per
exchange, priority for BTC/ETH/SOL/HYPE and larger OI. Pages and requests obey the
same exchange-wide budgets as LSAR. Long history across thousands of contracts
can take considerable time. API polling does not create duplicate jobs.

Cached settled points live in ignored `.cache/funding-history/`, with compact
in-memory summaries to bound memory. Updates reuse verified points and fetch new
periods, not the entire already-cached year. These are rebuildable caches, not a
durable multi-instance database; an ephemeral Render redeploy may discard them.
Current inventories refresh no more often than every five minutes and retain
unchanged fresh contracts during incremental scans. Readings older than fifteen
minutes are not weighted.

## Sources and request-limit evidence

Reviewed public documentation on 2026-10-13:

- Binance: [USD-M funding history](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History),
  [fundingInfo](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-Info),
  [COIN-M funding history](https://developers.binance.com/docs/derivatives/coin-margined-futures/market-data/rest-api/Get-Funding-Rate-History-of-Perpetual-Futures).
  USD-M fundingRate/fundingInfo share 500 requests/5min per IP; our combined
  fapi/dapi allowance is 350/5min, separate from LSAR's futures/data allowance.
- [Bybit ticker fields](https://bybit-exchange.github.io/docs/v5/market/tickers),
  [instruments](https://bybit-exchange.github.io/docs/v5/market/instrument),
  [funding history](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate).
- [OKX public API](https://www.okx.com/docs-v5/en/#public-data-rest-api).
- [Gate perpetual API](https://www.gate.com/docs/developers/apiv4/en/#futures).
- [Bitget current funding](https://www.bitget.com/api-doc/contract/market/Get-Current-Funding-Rate).
- [MEXC current funding](https://www.mexc.com/api-docs/futures/market-endpoints/get-funding-rate),
  [history](https://www.mexc.com/api-docs/futures/market-endpoints/get-funding-rate-history):
  native collectCycle, pages up to 1000; conservative 8 requests/2s.
- [KuCoin funding history](https://www.kucoin.com/docs-new/rest/futures-trading/funding-fees/get-public-funding-history):
  public weighted quota; conservative 40 total calls/30s.
- [Kraken public rate limits](https://docs.kraken.com/api/docs/guides/futures-rate-limits):
  public derivatives endpoints do not consume authenticated budget; our
  conservative global cap is 12 calls/10s regardless.
- [Hyperliquid limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits):
  1200 REST weight/min; info usually 20 plus history response-size weights.
  We reserve at most 6 info calls/min, including worst-case 2000 history rows.
- [Hyperliquid perp info](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals).
- [HTX public derivatives API](https://www.htx.com/en-us/opend/newApiPages?id=8cb7ec03-77b5-11ed-9966-0242ac110003).
- [Deribit API](https://docs.deribit.com/).
- [Aster published API sources](https://github.com/asterdex/api-docs).
- [BingX public docs](https://bingx-api.github.io/docs/#/en-us/swapV2/market-api.html).
- [CoinEx funding](https://docs.coinex.com/api/v2/futures/market/http/list-market-funding-rate).
- [Lighter API](https://apidocs.lighter.xyz/), [Paradex API](https://docs.paradex.trade/),
  [BitMEX API](https://www.bitmex.com/api/explorer/).

Where the current endpoint ceiling could not be extracted from migrated/dynamic
documentation, the configured cap is a **conservative operational allowance**,
not a claim of a newly verified exact exchange ceiling. Provider response quotas,
429/418/403 and application-level rate errors override local allowances. This
cannot guarantee no ban: shared hosting egress and other applications can consume
the same IP allowance.

All modules import one `exchangeRequests` runtime; never instantiate independent
budgets for new order-flow sections. Multi-process deployment requires a shared
atomic limiter and persistent cooldown storage before horizontal scaling.

## Multiplier contract grouping

Funding uses LSAR's shared canonical asset and display-name rules. Prefixes such
as 100, 1000, 10000 and 100000 identify multiplier contracts for the same
underlying coin, so 1000PEPE and PEPE share one row across venues. USD OI is
converted by the provider before grouping and must not be divided again.
Funding percentages are unaffected by the contract multiplier. Original contract
symbols remain intact for historical API requests and history cache keys.

Display names get one vote per exchange; the most common exchange name wins.
Within an exchange, OI is summed by name before choosing its vote. Tied votes use
USD OI, then a deterministic ticker comparison, just like LSAR. Single-exchange
coins retain their exchange's name. Ordinary numbered tickers such as 1INCH and
2Z are not treated as multiplier contracts.
