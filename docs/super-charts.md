# Super Charts (Indicators)

`/super-charts` has two tabs within the existing application header and theme.

## Technical Indicators

Uses TradingView's official hosted Advanced Chart widget, not the licensed
Advanced Charts library or an unofficial market-data API. TradingView supplies
the chart data. No API key, additional backend polling, or package is required.

The shared app contract picker selects verified crypto USDT perpetual tickers
from seven venues. A multi-select dropdown configures RSI, MACD, EMA, SMA and
Bollinger Bands. Timeframe controls stay inside TradingView's chart toolbar.
Changes inside the cross-origin chart cannot be read back into app controls;
app market/study changes or theme changes rebuild the embed from those controls.
Drawings and settings made inside the widget are not persisted by our app.

Default: Binance BTCUSDT perpetual, 1h and RSI. Symbol availability is decided
by TradingView and can differ from our screeners' exchange coverage. Unsupported
symbols display TradingView's own unavailable-market state.

The widget script and iframe require access to TradingView's external domains.
Script failure shows a retry and a link to TradingView. Slow iframe loading
shows a delay message. An iframe load event confirms only that the frame loaded,
not that live quotes or every indicator have been independently verified.
Keep TradingView attribution visible.

## Orderflow Indicators

Contains the approved Liquidity Zones adaptation of the user-supplied Pine v6
indicator, on a separate exchange-data chart. See `liquidity-zones.md` for its
calculation rules, request protection, licence and data limitations.

The Orderflow dropdown also includes Multi-Exchange Aggregated Funding Rate.
Multiple custom panels can appear together below the hosted chart; see
`chart-workspace.md` for shared market search and independent panel controls.
See `funding-indicator.md` for its live aggregation modes, settled-history
comparison, contemporaneous OI tracking and exchange coverage.
The hosted TradingView widget does not accept our custom data or indicators.
For future custom charts, use our own calculations and a suitable chart library,
or obtain access to TradingView Advanced Charts and supply our own data feed.
Advanced Charts custom indicators use JavaScript, not Pine Script.

Any new exchange data must use the shared request budgets and cooldowns.

Official references:
- https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/
- https://www.tradingview.com/free-charting-libraries/
- https://www.tradingview.com/charting-library-docs/latest/custom_studies/
