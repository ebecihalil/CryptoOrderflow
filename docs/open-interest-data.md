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
- Top gainers and losers use **rolling 24h coin-equivalent quantity change**,
  independently of the table's selected candle TF. For each contract, compare
  its latest fresh observation with a baseline at or up to five minutes before
  that observation minus 24h. No later baseline or interpolated value is used.
  Both views reuse cached inventory and request gates. Contract sizes display
  K/M/B without changing calculation or sorting quantities.
- Rankings require a verified crypto identity from the app's local catalogue.
  Stocks, ETFs, commodities and unknown identities do not enter rankings.
  Coverage counts represent crypto coins with at least one paired venue, not
  complete venue coverage; partially matched coins may differ from other sites.
  LSAR/Funding likewise include only verified crypto identities, with known
  financial-contract overrides and stock suffix exclusions. Unclassified new
  symbols are withheld until identified, not assumed to be crypto.
- Financial identity exclusions use local provider security metadata (explicit
  stock/ETF categories and tokenized-security names), not just a few ticker
  blacklist entries. Crypto catalogues also contain tokenized equities and ETFs:
  those identity IDs override a crypto-logo match. Metadata is maintained by
  `npm run update:coin-logos`, reusing that command's listing responses; it is
  never fetched by market polling, browser reload, or server startup.
- Binance USD-M, Bybit linear and Gate USDT backfill five-minute OI observations.
  A shared 30h native history serves all TFs and rolling rankings.
  Other venues/contracts accumulate real observations in a local cache.
  Missing history is a dash. Longer candle TFs need a previous-candle observation;
  rolling rankings need a genuine 24h baseline. They remain incomplete until then.
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
request gates. Fair FIFO history queues drain continuously with at most two
workers per venue, honour cooldowns and deduplicate jobs across TFs and callers.
Failed attempts wait five minutes; successful but insufficient responses wait
30 minutes before retrying. Once required baselines exist, new genuine snapshots
fill history forward without another full backfill.
Refresh/browser reload reads shared state instead of forcing inventory scans.
Sampling and backfill scheduling continue while the Node process runs after the
OI page is first opened, without requiring browser polling. Bybit backfill uses
two bounded 15h chunks; Gate uses documented `from`/`interval`/`limit` chunks.
Only new provider observations are saved; repeated reads cannot create history.
Native and sampled observations are merged, deduplicated, pruned after 30h and
saved atomically with batched writes. Both streams fit the retained point budget.

Default history storage is `.cache/open-interest`, not deployed/committed.
An optional `OI_HISTORY_DIR` environment setting points to an operator-provided
persistent directory (for example a mounted host disk outside the repository).
This setting does **not** provision storage. Ephemeral hosting still loses local
history on rebuild; supported native backfills reload, while other venues need
time to collect history again. To retain it across Render deployments, the
operator must supply persistent storage and set that directory in the host.

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
