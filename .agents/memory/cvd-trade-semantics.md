---
name: CVD and trade-bubble semantics
description: Verified taker execution data, CVD continuity, one-week history and separate Aggressive bubbles
---

Keep Spot CVD and Perpetual CVD separate, using exchange-reported taker direction.
Sum signed executed traded value, never OI-weight it or estimate taker flow from
price candles or total volume. Multiplier tickers still represent the same asset,
but notional conversion must respect each venue's actual quantity/contract units.

**Why:** The user wants their own exchange-fed orderflow indicators because
TradingView's CVD data does not provide the coverage they need.

**How to apply:** Preserve this distinction when extending feeds and units.
Unavailable feeds/history must not silently become zero contributions.

The user accepted verified available history plus live recording, then clarified:
"you dont need to have a 3M data. Only a week is fine."

**Why:** The user explicitly reduced the historical requirement to one week.

**How to apply:** Default to a weekly anchor, disclose the actual recorded start
and gaps, and do not require or invent three months of history. A weekly anchor
does not prove that a full prior week is already available.

The user requires each CVD candle to open at the previous candle's close.
Reconnects, newly contributing venues and incomplete coverage must not reset the
observed cumulative balance or discard executions earlier in the same candle.
Only the selected calendar anchor boundary resets it.

**Why:** The user reported that candles did not behave like price candles and
explicitly said "new candle must start at the close of previous candle."

**How to apply:** Carry known signed flow across coverage gaps while marking
coverage incomplete; leave missing candle periods absent rather than estimating
trades or creating zero-volume candles.

The user requested a separate indicator named exactly "Aggressive bubbles".
It is not a CVD display mode and must remain independently selectable.

**Why:** The user wants Bookmap/DeepCharts-style executed-trade bubbles alongside
their existing CVD and other native chart indicators.

**How to apply:** Use original executed price, time, taker side and gross volume.
Keep opposite-side activity visible even when net CVD is zero. Reuse shared trade
collectors; never reconstruct price-level bubbles from cumulative CVD candles.
Do not call bubbles an order-book heatmap or proof of institutional activity.

Spot bubbles must show a centered S and Perpetual bubbles a centered P, including
small bubbles rather than labeling only the largest ones.

**Why:** The user explicitly asked to distinguish the two markets by a letter
in the middle of each bubble.

**How to apply:** Preserve these labels when changing bubble sizing or styles;
keep the letters legible in both light and dark themes.

USD-M Binance trade streams require its routed market endpoint after its 2026
migration. An unrouted socket can accept a subscription yet never deliver trades.
BingX perpetual trade messages lack execution IDs; hashing identical records
can discard legitimate fills. MEXC futures may send singleton rather than array
trade data, and its spot trade stream uses protobuf.

**Why:** All three produced open-but-empty collectors until checked against
actual live messages and the routed-endpoint migration documentation.

**How to apply:** Verify live valid execution counts, not merely subscription
acknowledgments, before marking a venue as contributing; preserve identical
legitimate ID-less records and disclose limitations on replay deduplication.
