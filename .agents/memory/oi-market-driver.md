---
name: Aggregated OI market-driver indicator
description: Exchange-fed adaptation of the user's OI Pine script and liquidation significance rule.
---

The user wants the supplied Multi-Exchange Aggregated Crypto Open Interest
indicator's logic and rules retained, but CVD, OI, liquidations and LSAR sourced
directly from Binance, Bybit, OKX, Gate.io, MEXC, Bitget, BingX, KuCoin, Kraken
and HTX where verified feeds exist.

**Why:** The user explicitly requested exchange data rather than TradingView
feeds, with only one requested rule change.

**How to apply:** Do not silently replace the state matrix, spike sequence or
pullback rules with a simpler classifier. Verify metric compatibility and
coverage rather than assuming every requested venue supplies every metric.

The user said liquidations should count as "no liquidation" when
liquidation/open interest is below 0.5%.

**Why:** This is the user's explicit change to the supplied indicator's rules.

**How to apply:** Use comparable liquidation and OI units and the same chart
period. Treat this as a classification threshold, not a claim that no actual
liquidations occurred. Missing data must not be interpreted as below threshold.
