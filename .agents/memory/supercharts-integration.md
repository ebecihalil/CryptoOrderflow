---
name: Super Charts integration
description: User's native-chart choice, volume aggregation and truthful funding-history rules.
---

Use one app-native exchange-fed chart for technical and orderflow indicators.
The user said “we will use only one chart and we dont need any tradingview app
at all,” replacing the previous hosted-chart/separate-panels decision.

**Why:** the user wants their own exchange-fed orderflow indicators and technical
indicators together, without the hosted widget's custom-data restrictions.

**How to apply:** do not restore the hosted TradingView widget or re-request an
Advanced Charts company agreement. Keep open-source chart-library attribution.
Coinglass is a concept reference, not permission to claim feature parity.

Chart updates must preserve all other previously agreed application and indicator
rules.

**Why:** the user explicitly asked, “Please make sure all other rules are the same.”

**How to apply:** a chart presentation change is not permission to change existing
calculations, indicator logic, exchange-request safeguards or market inclusion rules.

Liquidity Zones volume must sum Binance, OKX, Gate.io and Bybit in comparable
underlying-coin units with matching candle timestamps; prices remain native to
the selected exchange. Do not OI-weight traded volume or zero-fill absent data.

**Why:** the user explicitly requested these four exchanges' combined volume.

**How to apply:** preserve multiplier matching, disclose partial/cohort coverage
and keep price/technical studies usable when aggregate volume fails.

Funding supports live aggregation and settled mean/median history; historical
OI-weighted points require recorded contemporaneous observations, never today's
OI applied retroactively. Missing history is not zero funding.

**Why:** the user chose “Live indicator + settled history” after learning that
historical OI coverage varies across exchanges.

**How to apply:** distinguish settlements from live forecasts and observed
weighted history; disclose fallback and do not invent pre-tracking records.

The shared price viewport resets for market/timeframe changes, but persists
through polling and indicator toggles/settings changes.

**Why:** the user now uses one combined analysis chart, not independent plots.

**How to apply:** changing a funding method cannot silently move the whole price
timeline; avoid remounting the chart when enabling a data-dependent pane.

Bundling is not proof the chart renders. Browser checks must inspect console
errors as well as uncaught exceptions because React can catch a render failure
and display a recovery page. Cached diagnostics can reference old source.

**Why:** an undefined render identifier passed Vite bundling/static tests and was
only exposed by a real browser check; cached diagnostics described old imports.

**How to apply:** verify the actual loaded chart and console after refactors.
For dynamic native panes, restore stretch proportions together after creation,
not sequential heights that can progressively squeeze sibling panes.
