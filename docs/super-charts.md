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

## Popular indicators (registry)

`src/lib/extra-indicators.js` adds 18 widely used studies, computed locally
from the selected exchange candles (warm-up bars omitted, never zero-filled),
with standard defaults:

| Group | Indicators (defaults) |
| --- | --- |
| Moving averages | WMA (20), Hull MA (9), VWAP (UTC-day anchored) |
| Bands & channels | Keltner (EMA 20, ATR 10, ×2), Donchian (20) |
| Trend | Ichimoku (9/26/52, displacement 26; cloud projected ahead), Supertrend (ATR 10, ×3), Parabolic SAR (0.02/0.02/0.2) |
| Oscillators | Stochastic (14/1/3), Stochastic RSI (14/14/3/3), CCI (20), Williams %R (14), ROC (9) |
| Trend strength & volatility | ADX/DMI (14), ATR (14, Wilder) |
| Volume | MFI (14), OBV, Chaikin Money Flow (20) |

Overlays draw on the price pane (Ichimoku/Keltner/Donchian fills via
`band-fill-primitive.ts`); oscillators get their own pane with reference
levels. Parameters are editable under Study parameters and saved per coin.
Volume-based studies use the selected exchange's candle volume. Values can
differ slightly from other platforms when history depth or seeding differs.

## Timeframes

1m, 3m, 5m, 15m, 30m, 1h, 4h, 1D, 1W, 1M, 3M (`server/timeframes.js`, all UTC;
weeks start Monday, months/quarters on the 1st). Native exchange candles are
used where documented (Binance/Bybit/OKX/Bitget/BingX 1m–1M, OKX 3M); other
frames are built from smaller native candles (Gate/MEXC 3m from 1m, Gate/MEXC/
BingX 1W/1M from 1D, 3M from 1M), dropping an incomplete first bucket.
Technical studies, Liquidity Zones, aggregated volume, CVD, aggressive bubbles
and funding use the same buckets. CVD/bubbles come from recorded trades (up to
14 days), so 1W/1M/3M show only the recorded part. Aggregated OI supports
1m–1D; weekly and longer frames show an explanation instead of thin bars.

Seconds (1s, 5s, 15s, 30s): perpetual exchange APIs publish no seconds
candles, so they are built from the selected contract's live executed trades
(`server/secondCandles.js`), starting when the chart is first opened and kept
for 2 hours (recording stops after 10 idle minutes). Volume is the single
contract's; minute-based layers (CVD, bubbles, funding, OI) start at 1m.

The timeframe control shows starred favourites as quick buttons; the dropdown
lists every timeframe with a ☆ to pin or unpin it (stored in the browser).

## Pane legends and settings

Each pane shows TradingView-style labels at its top-left: name, inputs and
values at the crosshair (latest bar otherwise). ⚙ opens that layer's settings
together with "How to read it" (summary, lines/colours and common signals, see
`src/lib/indicator-help.ts`); × removes the layer. Settings that used to sit
below the chart (study periods, Liquidity Zones, funding, CVD, bubbles, OI)
live in these panels. Chart colours use a brighter pastel palette
(`CHART_COLORS`) so candles, volume and indicators stay clearly visible.

## Full screen and indicator settings

"Full screen" (next to Fit view) fills the screen with the chart: the
indicator menus stay on top, the timeframe row above the chart, and the coin
watchlist on the right. Esc or "Exit full screen" returns to the normal page.

Indicator settings stay while the indicator is on the chart (also across
reloads). Removing an indicator resets its settings, so adding it back starts
from the defaults.

## Market list

The right side of Super Charts lists every USDT perpetual on Binance, Bybit,
OKX, Gate.io, Bitget, MEXC and BingX (the same coin on several exchanges is
listed once per exchange) with last price, 24h change and 24h change %.

- Click a row to chart it. Click a column title to sort (default: 24h volume).
- Exchange buttons, Gainers / Losers and "Move ≥ x%" filter the list; the
  colour dots show only rows of one colour.
- The small circle colours a row; × removes it from your list. Reset shows every
  coin on every exchange again and keeps your colours. All saved in the browser.
- Prices come from `GET /api/market/tickers`: one bulk ticker request per
  exchange every 30 s (Binance every 60 s), shared by all visitors and only
  while someone has the page open (`server/marketTickers.js`).

The old server "coin watchlist" panel is no longer shown on this page; coins it
was already recording keep recording.
