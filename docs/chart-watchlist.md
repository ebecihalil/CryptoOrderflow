## Individual chart settings

Each underlying coin has separate selected technical/orderflow indicators,
indicator parameters, timeframe, volume visibility and volume basis. Switching
through the watchlist or contract search restores that coin's own settings.
Aggressive bubbles minimum USD and market selection are included.

Zoom, horizontal position, manual price scales and pane proportions are saved
for each native exchange contract and timeframe. The view uses a timestamp
anchor so live snapshots dropping older bars do not silently move the saved
position to different candles. If the saved timestamp is no longer available
from the provider, the nearest available timestamp is used with the same zoom.

Preferences are personal to the browser and saved locally, independently of the
shared server recording list. They survive page reloads, but clearing browser
storage removes them; blocked storage supports same-session switching only.
Only the active coin's chart is mounted, so restoring views does not keep extra
client polling loops or exchange feeds open.

# Super Charts watchlist

The right-hand desktop watchlist (stacked on narrow screens) saves up to **five
unique underlying crypto assets**. Each has a preferred native price-chart
exchange/contract. Add the current contract, update its preferred venue, remove
it, or click a saved entry to switch without resetting selected indicators.

The list is **shared server-wide**, not a private per-browser portfolio. The
existing app has no user accounts; five is the global continuous-recording cap.
Native price candles are retrieved for the selected chart. Watchlist recording
specifically retains executed-trade data for Spot CVD, Perpetual CVD and Aggressive
bubbles; this does not imply continuous background funding/OI history collection.

## Background collection

- Every watched asset pins both Spot and linear Perpetual cohorts.
- Chart viewers, timeframe changes and bubble filters reuse those same collectors.
- One verified USD/USDT/USDC market is used per available exchange and market type.
- Existing ten-exchange stream validation, deduplication, timestamp ordering and
  conservative shared exchange request/connection gates are unchanged.
- Pinned cohorts are protected from normal idle/LRU eviction. Removal releases
  their continuous-recording slot; a currently viewed indicator may then restart
  collection on demand under the existing four-cohort unpinned limit.
- Background queues flush once per second with the existing 2.5-second reorder
  delay. Disk checkpoints are bounded to about every 15 seconds and serialized,
  with asynchronous gzip compression, not a full rewrite for each incoming trade.
- Collector source counts reflect actual received valid trades. Partial,
  unavailable, loading and storage-failed states are surfaced, never substituted
  with estimated history.

## Recording and hosting

CVD minutes retain the existing fourteen-day policy (the previous full calendar
week plus the current week). Bubble five-minute/side/0.05%-price-band aggregates retain
up to seven days and 150,000 cells per market, with truncation disclosed.

Five minutes is the smallest supported chart frame. Compacting at that base frame
reduces storage/memory without losing any supported chart's side, price-band,
value, quantity, source-count or trade-count detail. Existing minute archives
are validated and merged on restore; this is not synthesized price history.

History begins when executions are actually observed. Coverage gaps, offline
periods, pre-recording history and unlisted markets are not fabricated. Bubbles
remain gross buy/sell activity, not OI-weighted or reconstructed from CVD OHLC.
Only the 500 largest threshold-matching bubbles are displayed; sufficiently
coarse chart timeframes provide a longer native price-history window.

The watchlist and compressed recordings default to `.cache/cvd-recordings/`.
They are atomically checkpointed and survive a process restart **when the same
filesystem is preserved**. `.cache` is excluded from Git and deployment bundles.
An optional `WATCHLIST_DATA_DIR` selects a persistent recording directory for
both watchlist configuration and trade history. For hosted deployment, point it
to a mounted persistent directory outside the repository, for example
`/var/data/crypto-orderflow`.

An ephemeral filesystem can lose all local files on redeploy. A sleeping/stopped
server cannot receive trades. The app cannot make an ephemeral or sleeping host
durable by itself; provision persistent storage and an always-running service
when continuous week-long history is required.

API:
- `GET /api/chart/watchlist`
- `POST /api/chart/watchlist` with `{ "exchange": "binance", "symbol": "BTCUSDT" }`
- `DELETE /api/chart/watchlist/BTC`

Adds validate against the live chart catalogue. Duplicate underlying assets update
the preferred chart contract rather than creating another slot. Mutations are
serialized, capped at five, saved before reporting success, and reject a mismatched
browser Origin. This is not account-level authorization.
