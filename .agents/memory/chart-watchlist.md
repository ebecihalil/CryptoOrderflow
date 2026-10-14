---
name: Background chart watchlist
description: User-selected five-coin continuous recording scope and shared-server resource policy
---

The user selected a maximum of five continuously recorded coins after asking for
a right-side list that lets them return to coins while their data runs in the
background. Keep aggregated Spot/Perpetual CVD and bubble recordings for a
one-week target; do not imply pre-recording history exists.

**Why:** The user wants to return to observed historical data without having to
keep each coin's chart selected. Five was the user's accepted choice to control
connection and storage load.

**How to apply:** Watch by underlying identity, not chart exchange or bundled
symbol spelling. Switching the preferred price venue must reuse recorded flow.
Protect watched cohorts from idle eviction and preserve independent indicators.

Each watched coin must restore its own selected indicators, all indicator
parameters (including Aggressive bubbles minimum USD), timeframe, zoom, scroll,
price scale and pane sizes exactly as left when switching away and returning.

**Why:** The user said resetting their chart conditions wastes time and explicitly
requested independent settings for every watchlist coin.

**How to apply:** Keep personal UI preferences separate from the shared recording
queue. Settings follow canonical underlying identity; chart views are specific
to the native price contract and timeframe to avoid mixing incompatible price
scales. Persist in the user's browser, not as shared global server settings.

The recording list is currently server-wide rather than private per-browser.

**Why:** The app has no accounts, and an unlimited background collector set per
anonymous visitor would undermine the agreed resource cap.

**How to apply:** Keep the shared scope explicit. If private watchlists are added,
separate personal preferences from a globally bounded, deduplicated collector
pool; do not multiply exchange feeds by user count.

History files are only as durable as the hosting filesystem and trades are only
received while the server is running.

**Why:** The user uses separately hosted deployment, where local files and server
uptime cannot be assumed to persist through redeploys or sleep.

**How to apply:** Disclose this rather than promising continuous or durable
history without appropriate hosting/storage.

The background bubble archive compacts to the smallest supported chart frame
(currently five minutes); do not claim it retains raw execution timing.

**Why:** A week of five coins across both markets multiplies storage and memory.
Compaction preserves all current chart outputs without retaining unnecessary
minute cells or individual fills.

**How to apply:** Introducing a finer chart frame requires recording finer data
going forward. Never split archived coarser price-band aggregates into invented
finer bubbles.
