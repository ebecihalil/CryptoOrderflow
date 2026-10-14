---
name: Super Charts integration
description: Shared Advanced Charts direction, direct exchange feeds and custom indicator semantics.
---

Keep separate Technical Indicators and Orderflow Indicators selection menus,
but allow multiple selections to apply concurrently to the same chart. The user
chose TradingView Advanced Charts to preserve the full TradingView interface,
with price and custom indicator data supplied directly by exchanges.

**Why:** the user changed the earlier separate-chart approach and explicitly
selected “Keep the full TradingView interface” over an app-native shared chart.

**How to apply:** use authorized Advanced Charts access, not the restricted hosted
widget or a silent Lightweight Charts replacement. Preserve supplied indicator
semantics; do not invent additional formulas or fake orderflow charts. TradingView
prohibits putting its proprietary library in public repositories.

Contract search should offer coin/exchange autocomplete rather than a separate
exchange selector, covering Binance, Gate.io, OKX, Bybit, MEXC, Bitget and BingX.
Funding Rate and LSAR asset search should also offer matching suggestions.

**Why:** the user requested these seven chart venues and predictive asset search.

**How to apply:** show actual supported contracts, including exchange identity,
without invented listings or requests that bypass shared exchange limits.

Liquidity Zones volume may aggregate Binance, OKX, Gate.io and Bybit, but prices
remain from the selected chart exchange. Do not replace the traded-volume sum
with OI weighting or silently zero-fill missing venue candles.

**Why:** the user explicitly requested these four exchanges' combined volume
for the volume-dependent indicator.

**How to apply:** align candle times and underlying-coin units, including
multiplier contracts, and disclose participating venues/partial coverage.

For the aggregated funding indicator, the user approved live quotes with all
aggregation methods plus settled mean/median history; historical OI-weighted
points must come from recorded contemporaneous observations, never today's OI.

**Why:** the user chose “Live indicator + settled history” after being told that
historical OI coverage varies across exchanges.

**How to apply:** distinguish paid settlements from historical forecasts, label
partial coverage, and do not manufacture pre-tracking weighted chart history.

Native custom charts should reset their timeline when switching data domains
(asset, timeframe, history window or settled/live mode), but retain zoom on polls.

**Why:** changing from a single recorded-live point to a full settled series can
retain a very narrow viewport and make real history look like a flat line.

**How to apply:** distinguish an explicit dataset switch from a same-series refresh.
The hosted widget cannot consume our custom exchange data; use a separate chart
library or approved Advanced Charts access for that future work. Do not treat
TradingView's chart-control APIs as downloadable market-data APIs.

The official embed script changes its container's inline height to 100%.

**Why:** that override collapsed a visually reserved tall chart to the browser's
default 150px iframe because percentage height had no definite parent height.

**How to apply:** preserve a definite responsive container height that takes
precedence over the injected inline value. An iframe load event alone does not
prove quotes are available; keep loading/error descriptions truthful.

Pending TradingView scripts can execute even after being removed from the DOM.

**Why:** rapid indicator changes produced errors when a late script found that
its parent had been removed individually.

**How to apply:** isolate each embed in its own container, debounce insertion
and detach the entire subtree during cleanup so pending scripts retain their
parent. Do not reuse the same inner container for successive configurations.
