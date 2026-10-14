# Native Super Charts

`/super-charts` now uses one app-owned, exchange-fed chart. The hosted
TradingView widget and its external embed script are removed. Technical and
orderflow menus select layers in the same chart, not independent price charts.
The existing application header, theme and verified contract search remain.

## Price and technical studies

The selected perpetual contract supplies native OHLC through the existing
protected candle endpoint. Supported venues are Binance, Bybit, OKX, Gate.io,
MEXC, Bitget and BingX. The shared timeframe is 5m, 15m, 30m, 1h, 4h or 1D.
Candles refresh through cached, coalesced requests, not an unrestricted polling
loop. This is snapshot polling, not tick-by-tick trade streaming.

- EMA and SMA: configurable close-price moving averages.
- Bollinger Bands: configurable period and population standard deviation.
- RSI: Wilder gain/loss smoothing, with 30/70 reference levels.
- MACD: fast/slow EMA difference, EMA signal and histogram.

EMA seeds with a period SMA; RSI seeds from a period's price changes. A fully
flat RSI window is neutral at 50. Defaults are EMA/SMA/Bollinger 20, Bollinger
2 deviations, RSI 14 and MACD 12/26/9. Initial warmup points are omitted rather
than rendered as zeros. The forming candle can change while it develops;
different history depths and seeding conventions can differ from other sites.

## Existing orderflow indicators

Liquidity Zones retains the supplied script's rules and MPL source attribution.
It overlays confirmed zones on the same candlestick series. Selected-venue
volume or aligned underlying-coin volume from Binance, OKX, Gate.io and Bybit
can qualify zones. This is traded-volume summation, not OI weighting or CVD.

Aggregated Funding Rate appears in a lower pane on the same time axis. It
preserves mean/median/OI-weighted live values and actual settled history.
OI-weighted history uses recorded contemporaneous observations only; it cannot
retroactively apply today's OI to old payments. Funding is normalized to 8h,
positive red and negative green. Missing observations remain gaps.

All layers share zoom, horizontal scrolling and crosshair. Indicator toggles
retain the price viewport; selecting a different contract or timeframe resets
the data domain. Native prices remain available if aggregate volume or funding
is unavailable; missing custom data is not silently substituted.

This uses the installed open-source Lightweight Charts library, whose
attribution remains visible. It does not require Advanced Charts access, a
TradingView subscription, a company agreement or TradingView market data.
It is not a full clone of Coinglass's drawing tools or indicator catalogue.

See `chart-workspace.md`, `liquidity-zones.md` and `funding-indicator.md`.
