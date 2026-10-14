# Shared chart workspace

The user approved retaining the existing free hosted TradingView widget instead
of replacing it with Advanced Charts or an app-native price chart. No SDK,
company agreement, access token or paid TradingView subscription was added.

## Common selection

The app's contract combobox offers actual, active crypto **USDT perpetual**
listings from Binance, Bybit, OKX, Gate.io, MEXC, Bitget and BingX. Suggestions show
the contract and exchange together, such as `BTCUSDT — Binance`, retaining
native multiplier tickers such as `1000PEPEUSDT`. Choosing a contract drives:

- the hosted TradingView exchange/ticker;
- Liquidity Zones' selected-exchange price candles and volume controls;
- the Funding indicator's canonical underlying coin.

External exchange dropdown and duplicate TradingView timeframe buttons were
removed. Use TradingView's own controls for its price chart. The iframe does
not expose internal symbol/timeframe changes to this app, so custom panels retain
their independently selected timeframes. Use the **app contract picker** to
change both the hosted chart and custom panels together.

The metadata verifies exchange listing, not TradingView coverage. The hosted
widget may report an unsupported symbol even for an exchange-listed contract;
its existing error/external-link handling remains intact.

## Indicator menus and panels

Technical and Orderflow dropdown menus support multiple selections and removals.
RSI/MACD/EMA/SMA/Bollinger Bands configure the hosted chart. Changing externally
selected technical studies rebuilds the hosted embed, as before; internal
TradingView studies are controlled by TradingView, not mirrored into our menu.

Liquidity Zones and Aggregated Funding Rate can both be mounted below the chart.
Their settings, histories and calculations remain unchanged. They are **separate
plots on the same page**, not custom studies injected into the TradingView iframe.
Removing a custom panel stops its browser polling.

Funding Rate and LSAR screeners also have predictive searches using their already
fetched snapshot rows. Typing still filters immediately; suggestion selection,
arrow keys, Enter, Escape and pointer interaction are supported.

## Data and request protections

`/api/market/contracts` progressively loads seven metadata inventories once per
hour, coalesces in-flight loads, respects IP cooldowns and holds failed requests
for five minutes. No quote or OI collector is started for autocomplete. Browser
catalogue users share one request/cache; keystrokes are local. The browser polls
only while metadata is loading, refreshes hourly when stable, and exposes retry
for partial/unavailable results. Retry does not bypass exchange gates.

Native custom price candles now support all seven selected exchanges. Native
instrument IDs remain separate from TradingView IDs. OKX volume uses base-currency
`volCcy`, Gate and MEXC contract quantities use verified native contract sizes,
Bitget uses base volume and BingX uses its reported native OHLCV volume. Daily
OKX/Bitget requests use UTC bars. All rows retain strict price/volume validation,
contiguous timestamps, per-series cache, coalescing and failure backoff.
History depth varies by endpoint: the current OKX price request returns up to
300 bars; other selected venues request up to 1,000. Indicators show the actual
available/aligned scan coverage rather than fabricating older bars.

Liquidity Zones' **aggregated volume** remains the user-approved four venues:
Binance, OKX, Gate.io and Bybit. A MEXC/Bitget/BingX price chart does not silently
add those venues to this volume aggregation. Underlying identity and multiplier
normalization are retained when the selected price symbol contains separators.

Endpoint references:

- Binance `/fapi/v1/exchangeInfo`, `/fapi/v1/klines`
- Bybit `/v5/market/instruments-info`, `/v5/market/kline`
- OKX `/api/v5/public/instruments`, `/api/v5/market/candles`
- Gate.io `/api/v4/futures/usdt/contracts`, `/candlesticks`
- MEXC `/api/v1/contract/detail`, `/api/v1/contract/kline/{symbol}`
- Bitget `/api/v2/mix/market/contracts`, `/api/v2/mix/market/candles`
- BingX `/openApi/swap/v2/quote/contracts`, `/openApi/swap/v3/quote/klines`
