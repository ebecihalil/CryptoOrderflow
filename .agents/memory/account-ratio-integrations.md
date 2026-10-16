---
name: Account-ratio integration constraints
description: Metric compatibility and rate-limit tradeoffs for adding exchange data.
---

Do not substitute top-trader account ratios, position ratios, or taker-buy/sell ratios for market-wide account ratios.

Distinguish OI-weighted raw L/S ratios from ratios reconstructed from OI-weighted
long/short account shares. Do not silently change the aggregation definition.

**Why:** a venue's extreme raw ratio can dominate the numeric average even with
modest OI weight. Converting that average to a long percentage does not produce
the OI-weighted long-account percentage. The user questioned this outlier effect.

**How to apply:** explain the two definitions before changing current or TF
calculations. Neither method reconstructs a pooled account-count ratio without
venue account counts, and source OI shares describe contributing venues rather
than automatically representing the entire market.

Use account-percentage-first OI weighting for the LSAR aggregation.

**Why:** after seeing how Toobit's extreme raw ratio amplified its influence,
the user explicitly selected “Weight account percentages first (recommended)”.

**How to apply:** apply the same definition to current aggregated LSAR and both
TF candles: OI-weight long/short account shares, then reconstruct L/S. Retain
matching contracts and identical USD OI weights on both sides, the ratio-relative
change definition, and long-share percentage-point changes. Do not change
individual exchange ratios or cap/remove a venue solely for having an extreme
ratio. Genuine OI concentration should still be visible.

LSAR has no maximum-price option or price cap, and exchange failure states
should be communicated through status signals without “IP blocked” prose.

**Why:** the user explicitly requested removing the maximum-price option and
keeping only the red signal instead of the IP-blocked text.

**How to apply:** do not silently retain the former $5 screener restriction.
Keep crypto-only identity filtering and server-side request limits/cooldowns;
hiding error prose must not bypass restrictions or misreport successful data.

**Why:** the user specifically trades changes in Long Short Account Ratio; mixing different populations would change the meaning of the screener.

**How to apply:** verify the exact endpoint's definition before adding any venue. HTX has not yet been confirmed to offer a compatible public market-wide account-ratio endpoint.

Verify the original exchange behind a branded tool before treating it as an independent source. As checked on 2026-10-13, XT's official AI TradeKit account-ratio tool fetches OKX data, not XT account data.

**Why:** counting the tool as another exchange would double-count an existing venue and distort OI-weighted aggregation.

**How to apply:** inspect upstream requests, not just tool descriptions. XT's public implementation is at https://github.com/XtApis/AItradekit/blob/main/mcp/xt_tradekit/datahub.py; recheck its current upstream before relying on this finding.

Use matching venues and unchanged OI weights in the current and prior candle. Do not compare one venue's stale candle against another venue's newer candle.

**Why:** missing history or asynchronous updates can otherwise fabricate an aggregate change.

**How to apply:** exclude unpaired observations; disclose coarser historical sampling and rate-limited, progressive loading rather than claiming simultaneous comprehensive coverage.

Combine exchange contract names such as `100X`, `1000X`, `10000X`, and `100000X` with plain `X` as the same underlying coin.

**Why:** the user explicitly wants contracts whose exchanges multiply coin units to reduce displayed zeros aggregated together, not treated as separate coins.

**How to apply:** normalize the name and per-coin price before grouping or price filtering; preserve USD OI and account ratios, and retain original contract symbols in expanded details.

The list's display name follows the majority of contributing exchanges' original coin names: two venues using `1000X` versus one using `X` must display `1000X`. A single-venue coin keeps that venue's original name.

**Why:** the user explicitly requested this naming rule while still aggregating multiplier aliases as one coin.

**How to apply:** count each venue once, not each contract. Keep canonical grouping separate from the displayed name. Tied votes use USD OI, then alphabetical order, to remain deterministic.

Show fetched exchange counts as a single line immediately below the OI-weighted positioning subtitle, with green indicators for successfully fetched data; do not restore coverage boxes.

**Why:** the user requested compact fetch visibility after removing the coverage boxes.

**How to apply:** count fresh, complete contracts independently of the screener's price/exchange filters. Support multi-select exchange filtering rather than a single-choice dropdown.

Distinguish time to first usable Binance data from the time to finish every contract. Optimize progressive delivery before increasing request concurrency.

**Why:** Binance's market-wide USD-M account-ratio endpoint advertises request weight zero but has a separate IP limit of 1,000 requests per five minutes (official docs checked 2026-10-13). Zero weight does not mean unlimited throughput; buffered results and slow UI polling can make successful requests look slow.

**How to apply:** measure both first-result and full-scan times, keep all contracts and matched candle/OI semantics, and verify current provider limits before raising concurrency. Reference: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio

Check the affected deployment's exchange status before treating zero Binance data as a loading-speed problem.

**Why:** Render returned HTTP 418 while the Replit preview fetched hundreds of Binance contracts successfully. Binance documents 418 as an IP ban following rate-limit violations; preview success does not establish production access.

**How to apply:** diagnose the actual site's API error, honor cooldown guidance, and verify fresh data from that same deployment before claiming recovery. Code can prevent further request bursts, but cannot remove an existing Binance ban. Reference: https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info

Treat a Binance 418/429 cooldown as a provider-wide hard pause for all market
modules: no new REST calls or WebSocket connections, and no retry polling before
the exchange-reported deadline. Allow only requests already in flight to finish;
their later ban deadlines must extend, never shorten, the shared pause.

**Why:** the user explicitly asked that an active Binance block must not trigger
more outbound requests, after seeing the reported ban deadline move later.

**How to apply:** share one limiter across modules and protocols, check it at
network admission, and persist it across process restarts/instances where the
hosting filesystem is ephemeral or traffic is distributed.
