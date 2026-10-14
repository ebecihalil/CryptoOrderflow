---
name: Super Charts integration
description: Shared hosted TradingView workspace, direct exchange-data panels and custom indicator semantics.
---

Keep separate Technical Indicators and Orderflow Indicators dropdown menus
with multiple selections. The user approved retaining the current hosted
TradingView price chart with custom exchange-data panels below it on one page,
not injecting custom indicators into the iframe.

**Why:** after discussing Advanced Charts access requirements and the hosted
widget's limitations, the user approved keeping the existing widget plus
separate custom plots on the same screen.

**How to apply:** do not silently replace the widget, require a proprietary SDK,
or promise custom iframe overlays or synchronized internal controls. Shared app
market search can drive the widget and custom panels; the widget's internal
symbol/timeframe changes cannot drive those panels. Preserve supplied indicator
semantics, with no invented formulas or fake orderflow charts.

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

The hosted widget can remove its bootstrap script after creating its iframe.
For initial symbol/config verification, inspect the iframe URL, not a script
element that may no longer exist; this does not expose its internal chart state.

**Why:** the real embed replaced the initialization script during live checks.

**How to apply:** verify rendered iframe configuration without assuming bootstrap
DOM lifetime or claiming cross-origin access to interactive chart state.
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
