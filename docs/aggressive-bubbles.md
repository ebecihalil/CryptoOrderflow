# Aggressive bubbles

A separate, independently selectable **Aggressive bubbles** Orderflow Indicator
on the native Super Charts **price pane**. It does not replace or modify Spot CVD,
Perpetual CVD, funding, liquidity zones or technical studies.

- Green = taker buying; red = taker selling.
- Spot = outlined circles; perpetual = filled circles.
- Bubble area scales with gross USD-equivalent executed value, subject to bounded
  minimum/maximum radii. Relative sizes are based on the displayed window.
- Market filter: Both markets, Spot, Perpetual.
- Minimum **bubble** value defaults to $10,000. This filters aggregated activity,
  not individual orders. Hover/crosshair inspection shows market, taker side,
  value, native price, execution count and contributing-source count.

The existing ten-exchange CVD collectors provide the original executed trades.
No additional parallel exchange sockets are created for this indicator. Cached
local snapshots refresh approximately every five seconds; changing filters,
timeframe or refreshing does not force upstream fetches or bypass limits.
Disabling the indicator stops its browser polling; shared on-demand collector
idle/capacity rules still apply.

## Calculation

Preserve both buying and selling even when their net CVD cancels. Separate Spot
from Perpetual. Group executions into minute cells by side and 0.05% logarithmic
underlying-price band, then combine those cells into the selected chart candle.
Price is underlying-quantity-weighted execution price, value is summed gross
traded notional, and source counts are distinct contributing venues. Apply the
minimum value to the combined bubble, not to individual fills before aggregation.
The response is bounded to the 500 largest matching bubbles.

Native bundled price × native quantity already gives notional. For a 1000-token
contract, divide execution price by 1000 and multiply underlying quantity by 1000.
For contract-lot venues, use verified contract sizes. Chart plotting converts
underlying prices back by the selected contract's price divisor. USD/USDT/USDC
quotes assume parity, not a live FX conversion.

## Coverage

Only newly recorded executions have price-level information. Previously recorded
CVD minute OHLC cannot reconstruct bubbles and is never used to invent them.
Actual bubble recording/history starts and source status are shown.

An in-memory buffer retains approximately two hours, capped to 12,000 minute/
price-band/side cells per market collector. Older cells may be trimmed earlier
under capacity pressure, with an explicit warning. Restart loses the bubble
buffer; CVD's separate persisted minute history is unchanged. This is not promised
weekly bubble history or historical archive backfill.

Inherited CVD feed scope, taker-side validation, deduplication and reorder/safety
limitations remain in effect. Aggressive identifies **market-taking executions**,
not institutions, resting orders or spoofing. An order-book heatmap would require
a separate sequenced depth feed.

API: `/api/indicators/aggressive-bubbles?asset=BTC&market=both&timeframe=1h&minValue=10000`.
The overlay is a price-series primitive: it follows native pan/zoom, resizing,
theme and scaling without recreating the chart or adding a new indicator pane.
