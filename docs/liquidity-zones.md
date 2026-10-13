# Liquidity Zones

The Orderflow Indicators tab in `/super-charts` implements the supplied Pine v6
Liquidity Zones indicator, attributed to its original author under MPL 2.0.
The adapted source is `src/lib/liquidity-zones.ts`; preserve its licence header.
Its preferred unminified form is publicly available from the linked
`/api/indicators/liquidity-zones/source` endpoint.
The user-supplied original remains in `attached_assets/`.

## Logic preserved

- Default scan: 300 bars. Like the source, the cutoff is inclusive and applies
  to the pivot's **confirmation** bar, not its original pivot bar.
- Pivots have 10 bars on either side, so they become available 10 candles later.
  Equal extrema select the latest pivot.
- Pivot-bar volume must be strictly above that bar's 20-bar volume SMA ×
  sensitivity (default 1.2). This is exchange-specific traded base volume.
- A candidate joins the **first** cluster whose entire expanded price width
  is no larger than ATR(14) at the **confirmation** bar. ATR uses true range
  and SMA-seeded Wilder smoothing, not an ordinary 14-bar range average.
- Two qualified pivots create the zone. Highs are processed before lows.
  The box extends right from the first pivot's time; that historical left edge
  must not be mistaken for a zone that was already known at that time.
- Above the top: support/green. Below the bottom: resistance/red. Inside,
  including exact bounds: grey, preserving the last known outside-side state.
- A breakout condition occurs only when the close reaches the opposite outside
  side. Touch follows the source exactly: high OR low must be **within** the
  zone. A wick spanning both bounds is not automatically counted.
- Colours are user-controlled; defaults are Pine red/green/grey and 35%
  transparency. There are no arbitrary extra filters or trading signals.

## Data and limitations

The hosted TradingView Technical Indicators widget remains unchanged. Our custom
chart uses TradingView Lightweight Charts with Binance USD-M or Bybit linear
USDT perpetual price candles. It does not run Pine inside the TradingView embed, and
does not download TradingView data. No account, key or order-book data is used.

The server validates perpetual metadata and verified crypto identity, retrieves
up to 1,000 candles, rejects malformed or gapped histories and distinguishes
closed and forming bars. Indicators recompute from the full supplied history,
so provisional forming-candle events can disappear, as with Pine's realtime
rollback. The UI displays recent events; it does not deliver TradingView alerts,
push notifications, webhook messages or automatic trades.

Scan length is limited to 50–900 bars to retain some preceding indicator warmup
within the provider's 1,000-bar response. Newly listed markets may supply fewer
bars. ATR initialization and different exchange candles can yield different
zones from a TradingView chart with a longer history. Exact platform parity
has not been independently established.

### Aggregated volume

The default volume basis sums **matching USDT perpetual** traded volume from
Binance, OKX, Gate.io and Bybit. It is not OI-weighted and does not mix spot,
inverse or USDC markets. OHLC prices, pivots and ATR still belong to the
selected price exchange. Both histogram bars and the volume/SMA qualification
use the same summed series. “Selected exchange” restores the original volume.

All amounts are converted to the actual underlying coin. Binance/Bybit base
volumes on `1000X` contracts are multiplied by the bundle size. OKX uses
`volCcy` (base currency, not `vol` contracts or quote turnover); Gate.io uses
`v × quanto_multiplier`, followed by underlying-symbol normalization. A
venue contributes one active, verified crypto USDT perpetual per underlying.
Contracts are resolved from live metadata rather than guessing ticker strings.

Aggregation uses exact candle opening timestamps and one fixed set of available
venues across the entire supplied series. Missing candles are never zero-filled.
The newest contiguous common history is used; an unmatched forming candle may
be omitted. Fresh sources with insufficient history or more than one interval
of lag are excluded. Sources, partial coverage, latest aligned timestamp, actual
history length and underlying volume units are visible. Older cached data is
explicitly stale, never represented as a successfully fetched fresh venue.

Volume qualification is intentionally different from the original single-venue
indicator when this new mode is selected. The user requested combined volume;
the remaining Pine rules have not been changed.

These are inferred price/volume zones, not measured resting order-book liquidity.
The renderer uses native chart primitives so zones follow pan, zoom and resize.
Local settings and colours recalculate the indicator without new market requests.

## Request protection

All calls use the existing shared exchange HTTP client and IP-wide gates,
including metadata validation. Binance klines reserve their documented variable
weight (1/2/5/10 based on the requested limit; our 1,000 bars costs 5).
Bybit uses its existing conservative 30 requests/5 seconds global budget,
far below its documented 600 requests/5 seconds IP ceiling.

Per-market snapshots are cached for 30 seconds with concurrent request
coalescing. UI Refresh does not bypass the cache. Metadata expires after an hour.
Failures are cached for at least 60 seconds or the exchange cooldown, whichever
is later. Previously fetched candles remain explicitly stale with timestamps,
not silently labelled fresh. At most four chart markets may fetch concurrently,
and caches have bounded capacity. Nothing exempts this module from exchange bans.
Aggregation has an additional two-market in-flight limit and bounded caches.
OKX initially paginates history (up to 300 candles/page), then reuses old bars
and refreshes only the newest page, backfilling again if a historical gap forms.
Its existing global 3 requests/2 seconds gate is below both the candles
(40/2 seconds) and history-candles (20/2 seconds) documented IP ceilings.
Gate.io's existing shared 80 requests/10 seconds budget remains in force.
The frontend schedules the next poll after completion so long rate-gated
loads are not aborted and restarted every 30 seconds.

Sources:
- https://developers.binance.com/legacy-docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data
- https://bybit-exchange.github.io/docs/v5/market/kline
- https://bybit-exchange.github.io/docs/v5/rate-limit
- https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks
- https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks-history
- https://www.gate.com/docs/developers/apiv4/en/#futures-candlesticks
- https://github.com/gateio/gateapi-python/blob/master/docs/FuturesCandlestick.md
- https://tradingview.github.io/lightweight-charts/
- https://mozilla.org/MPL/2.0/
