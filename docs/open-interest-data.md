# Open Interest

## Metrics
- OI is **summed**, not OI-weighted. Coin-equivalent size converts each venue's USD
  OI using its mark price, including 100/1,000/10,000/100,000 symbol multipliers.
  The displayed size unit is the underlying asset, even when the majority
  exchange naming convention displays a prefixed contract name.
- TF choices are 5m, 15m, 30m, 1h, 4h and 24h. Change compares the latest available
  observations inside the current and previous candle. Both sums contain exactly
  the same matched contracts; unpaired sources are excluded, not assigned zero.
  Percentage change is in coin-equivalent quantity, so a price rise alone does
  not create an increase in linear OI size.
- Top gainers and losers always use the 24h candle comparison, independently of
  the table's selected timeframe. Both views reuse the same cached inventory and
  request gates. Contract sizes display K/M/B abbreviations without changing the
  underlying quantities used in calculations or sorting.
- Binance USD-M, Bybit linear and Gate USDT backfill five-minute OI observations.
  Other venues/contracts accumulate real observations in a persistent local
  cache. Missing history is shown as a dash. Longer TFs need a previous-candle
  observation; their rankings are incomplete until those observations exist.
- Historical counts use the same single-sided basis as current inventory:
  Bybit's `singleOpenInterest` is preferred; documented both-sided
  `openInterest` is halved when that field is absent. Gate's historical
  long-plus-short count is converted to the single-sided `position_size` basis.
- OI / 24-hour volume compares the same venues with available verified rolling
  volumes. Missing volume does not become zero. Base-volume quotes are valued
  at the latest mark/last price. The tooltip gives volume source coverage.
- This page uses all available verified venues from the shared Funding inventory.
  Funding's market-wide 1% eligibility cutoff is unchanged and is not an extra OI filter.

## Requests and caching
Funding and OI reuse the same current OI inventory, refreshed no more often than
five minutes per exchange. Extra bulk volume endpoints use the same per-exchange
request gates. History backfills run with at most two workers per venue, honour
cooldowns, and cache their prior-candle results for the selected TF's current
bucket. Refresh and browser reload read shared state rather than forcing scans.
Sampling continues while the Node process runs after the OI page is first opened.
Only new provider observations are saved; repeated reads cannot create history.
The local `.cache` directory is not deployed/committed. Hosts with ephemeral
filesystems lose locally sampled history on a rebuild; API backfills reload
supported venues. Persistent storage is needed to preserve other venue histories.

## CME: authorized daily reports
CME's website explicitly returned HTTP 403 prohibiting automated scraping during
implementation. The app does not bypass that restriction or copy a research
snapshot into live market data. Until authorized report data is supplied, CME
has a red signal, zero fetched contracts and contributes nothing to totals.

An operator can import an authorized daily report:
`npm run import:cme-oi -- /path/to/report.json`

The input JSON has `reportDate` (YYYY-MM-DD), `sourceUrl` (public provenance URL,
without credentials), and `records`. Each record has `productCode`, `contract`
(an expiry identifier or `ALL` for a product total), and `openInterestContracts`
(non-negative integer). Supported verified codes are BTC/MBT, ETH/MET, SOL/MSL,
XRP/MXP, ADA/MCA, LNK/MLN and XLM/MXL. Do not mix `ALL` totals with expiry rows.
The import validates units/dates/duplicates and atomically updates
`data/cme-daily.json`. This is an operator-only CLI, not a public data-writing API.

Imported daily coin-equivalent OI contributes to totals and is valued using the
largest current crypto-exchange OI venue's underlying-coin mark. Report dates are
identified on screen. It is not represented as live CME quotes. Reports older
than seven days are excluded. CME never contributes fabricated intraday changes
or trading-day volume to a rolling 24-hour ratio. Automatic daily updates still
require a licensed/authorized CME data source; importing is not an automatic feed.

Verified contract-size references:
- https://www.cmegroup.com/markets/cryptocurrencies/bitcoin/bitcoin.contractSpecs.html
- https://www.cmegroup.com/markets/cryptocurrencies/ether/ether.contractSpecs.html
- https://www.cmegroup.com/markets/cryptocurrencies/solana/solana.contractSpecs.html
- https://www.cmegroup.com/markets/cryptocurrencies/xrp/micro-xrp.contractSpecs.html
- https://www.cmegroup.com/markets/cryptocurrencies/ada-link-lumens-futures.html
- https://www.cmegroup.com/market-data/volume-open-interest.html
