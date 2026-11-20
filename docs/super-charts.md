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

Super Charts always opens as a big chart filling the browser window (the
computer's taskbar stays visible). One toolbar holds everything: CO (home),
symbol search, the coin and price, timeframes (favourites + More), Technical
Indicators, Orderflow Indicators, volume basis, Vol (volume pane), refresh and
Fit. Indicators are removed with × on their chart label; the market list is on
the right.

Indicator settings stay while the indicator is on the chart (also across
reloads). Removing an indicator resets its settings, so adding it back starts
from the defaults.

## Market list

Signed-out visitors see a locked panel with a blue Sign in button (it opens the
normal Sign in page, which links to "Create a free account"). Once signed in,
the list's colours, removed coins, filters and exchange priority are saved to
the account (`GET/POST /api/me/prefs/market-list`) and follow you to any device.

The right side of Super Charts lists every USDT perpetual on Binance, Bybit,
OKX, Gate.io, Bitget, MEXC and BingX (the same coin on several exchanges is
listed once per exchange) with last price, 24h change and 24h change %.

- Click a row to chart it. Click a column title to sort (default: 24h volume).
- "One row per coin" (on by default): open the exchange priority list. It has
  10 slots; pick an exchange in each slot from the dropdown (or leave it empty)
  and reorder with the arrows. Defaults: Binance, Bybit, OKX, Gate.io, Bitget,
  MEXC, BingX and three empty slots. Other exchanges are listed as "(soon)"
  until the list can chart them. Each coin is shown
  once, from the first exchange in that order that lists it; coins it lacks
  come from the next one, and so on. "+N" on a row lists the same coin on the
  other exchanges underneath it. Turn it off to list every exchange's contract.
- Gainers / Losers and "Move ≥ x%" filter the list; the
  colour dots show only rows of one colour.
- The small circle colours a row; × removes it from your list (in one-row mode
  the whole coin). Reset shows every coin again and keeps your colours and
  exchange priority. All saved in the browser.
- Prices come from `GET /api/market/tickers`: one bulk ticker request per
  exchange every 30 s (Binance every 60 s), shared by all visitors and only
  while someone has the page open (`server/marketTickers.js`).

The old server "coin watchlist" panel is no longer shown on this page; coins it
was already recording keep recording.

## Leverage Estimate on the chart

Orderflow Indicators → Leverage Estimate adds a 0–100 pane (80+ extreme,
60–80 elevated, 40–60 normal, below 40 low), the same estimate as the Leverage
Estimate page. Available on 5m, 15m, 30m, 1h, 4h and 1D.

## Exchanges behind each indicator

| Indicator | Exchanges |
| --- | --- |
| Aggregated Funding | 17 (all except CME and Toobit) |
| Aggregated Open Interest | 17 perpetual venues (same data as the Open Interest page) |
| Perpetual CVD, Aggressive Volume Bubbles (perp) | 15 (Binance, Bybit, OKX, Gate.io, MEXC, Bitget, BingX, KuCoin, Kraken, HTX, Aster, Hyperliquid, BitMEX, Deribit, CoinEx) |
| Spot CVD, Aggressive Volume Bubbles (spot) | 10 (Binance, Bybit, OKX, Gate.io, MEXC, Bitget, BingX, KuCoin, Kraken, HTX) |
| Aggregated volume, Liquidity Zones | up to 7 (Binance, OKX, Gate.io, Bybit, Bitget, MEXC, BingX); a venue whose gaps would cut over 20% of the matched history is left out for that coin |
| Leverage Estimate | 4 (Binance, OKX, Gate.io, Bybit: the venues publishing top-trader ratios) |
| Global Long Short Account Ratio | 6 (Binance, Bybit, OKX, Gate.io, Bitget, Toobit: every venue publishing an all-accounts ratio) |
| Top Trader Long Short Account Ratio | 3 (Binance, OKX, Gate.io: the venues publishing a top-trader account ratio) |

## Your setup follows your account

Indicators are not tied to a coin: the selected technical and orderflow
indicators, their settings, the timeframe, volume options and favourite
timeframes stay the same when you switch coins, until you remove them
(`src/lib/chart-settings-store.js`). Signed in, this setup and the market list
are saved to the account (`/api/me/prefs/super-charts`, `/api/me/prefs/market-list`)
and load on any device. Signing out returns this browser to the defaults
(RSI + Liquidity Zones, 1h; recent coins and chart zoom cleared; language and
theme kept). Signing in again brings everything back.

## Long Short Account Ratio panes

Orderflow Indicators → Global / Top Trader Long Short Account Ratio add a pane
with the ratio (long accounts ÷ short accounts; dashed line at 1.0) aggregated
across exchanges, weighted by each contract's USD open interest — the same
method as the LSAR pages. `GET /api/indicators/lsar-chart?asset=&timeframe=&kind=global|top`
(`server/lsarChart.js`). Exchanges publish 5-minute history (about a day) and
hourly history (about 12 days), so the panes cover 5m–1D. A candle is shown
only when exchanges holding at least 80% of the OI have a reading.

## Sign-in

Super Charts requires a free account. Signed-out visitors see the sign-in
form with example pictures of the main indicators and the exchange list
(`src/components/super-charts-gate.tsx`; pictures are drawn from fixed sample
data and labelled as examples).

## Save / Default on indicator settings

Every indicator with settings (⚙ on its chart label) has **Save** and
**Default**. Changes apply straight away; Save keeps them as your settings for
that indicator (used again when it is removed and added back, and saved to your
account); Default restores the original settings and forgets the saved ones.

In the market list, the circle left of "Symbol" filters by row colour.

## Bubble placement

Bubbles are recorded in 5-minute cells for 7 days (exact for 5m and larger
charts) and in 1-minute cells for the last 12 hours, used by 1m and 3m charts,
so every bubble sits on the candle in which its trades happened.

## Perp Leverage Estimation

Replaces the old Leverage Estimate pane (the Leverage Estimate page is
unchanged). Built only from data this server records: per-exchange open
interest, per-exchange perpetual and spot taker trades (buy/sell = footprint,
CVD, volume) and liquidations (Binance, Bybit, OKX, Deribit). An exchange counts
in a candle only when it has open interest (this and the previous candle), perp
trades and spot trades in that candle. Lines, 100 = normal for the coin (own
200-candle median): orange = average (open interest ÷ 20-candle average spot
volume, combined 70/30 with perp ÷ spot volume); green / red = long / short
side: new open interest is split by aggressive buyers (longs) vs sellers
(shorts); falling open interest is taken first from liquidations, then from the
side that was closing. Equal long and short = both on the orange line.
`GET /api/indicators/perp-leverage?asset=&timeframe=&exchange=&symbol=` (`server/perpLeverage.js`).
History starts when the server started recording the coin.

## Multi-chart layouts

The layout button next to the symbol search offers 1, 2, 3 or 4 charts (13
arrangements). Click a chart to select it (blue outline): the toolbar and the
market list then change that chart. Each chart keeps its own coin and
timeframe; indicators are shared by all charts.

## Exchanges with charts

Binance, Bybit, OKX, Gate.io, Bitget, MEXC, BingX, KuCoin, HTX, Hyperliquid and
Aster (candles, prices, contracts). Hyperliquid, KuCoin and HTX skip candles
with no trades; such minutes are shown as flat, zero-volume bars. Kraken,
Lighter, Paradex, Deribit, CoinEx, BitMEX and Toobit are used for data
(funding, open interest, trades) but are not chartable yet.

## Indicators always keep their pane

A selected indicator never disappears. Long Short Account Ratio and Perp
Leverage Estimation are published every 5 minutes: on 1m, 3m and seconds
charts they are shown as steps (each candle takes the latest 5-minute value).
Where an indicator has no data for the timeframe (e.g. Aggregated OI on 1W,
CVD on seconds charts), its pane stays with a message in the middle.

## Aggregated Open Interest

Classic aggregated OI candles in USD (open interest in coins × the chart's
price) from up to 17 exchanges, like an aggregated OI chart: every candle opens
at the previous close, a missing candle is drawn flat (no gaps), and a change in
which exchanges report never creates a fake jump (each candle's move comes from
the exchanges present in it and the one before; the series is scaled so the
latest candle equals the real current total). Green = OI up, red = OI down. The
driver's state colours and spike/pullback alerts are optional ("State colors"
in its settings).
