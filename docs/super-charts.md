# Super Charts (Indicators)

`/super-charts` has two tabs within the existing application header and theme.

## Technical Indicators

Uses TradingView's official hosted Advanced Chart widget, not the licensed
Advanced Charts library or an unofficial market-data API. TradingView supplies
the chart data. No API key, additional backend polling, or package is required.

The external controls select Binance, Bybit or OKX crypto perpetual tickers,
timeframes and RSI, MACD, EMA, SMA or Bollinger Bands. TradingView's own chart
toolbar also supports symbol, timeframe and indicator selection. Changes inside
the cross-origin chart cannot be read back into the external controls; applying
external controls or changing theme rebuilds the embed from those controls.
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
The hosted TradingView widget does not accept our custom data or indicators.
For future custom charts, use our own calculations and a suitable chart library,
or obtain access to TradingView Advanced Charts and supply our own data feed.
Advanced Charts custom indicators use JavaScript, not Pine Script.

Any new exchange data must use the shared request budgets and cooldowns.

Official references:
- https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/
- https://www.tradingview.com/free-charting-libraries/
- https://www.tradingview.com/charting-library-docs/latest/custom_studies/
