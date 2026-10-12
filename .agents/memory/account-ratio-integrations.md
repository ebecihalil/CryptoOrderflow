---
name: Account-ratio integration constraints
description: Metric compatibility and rate-limit tradeoffs for adding exchange data.
---

Do not substitute top-trader account ratios, position ratios, or taker-buy/sell ratios for market-wide account ratios.

**Why:** the user specifically trades changes in Long Short Account Ratio; mixing different populations would change the meaning of the screener.

**How to apply:** verify the exact endpoint's definition before adding any venue. HTX has not yet been confirmed to offer a compatible public market-wide account-ratio endpoint.

Use matching venues and unchanged OI weights in the current and prior candle. Do not compare one venue's stale candle against another venue's newer candle.

**Why:** missing history or asynchronous updates can otherwise fabricate an aggregate change.

**How to apply:** exclude unpaired observations; disclose coarser historical sampling and rate-limited, progressive loading rather than claiming simultaneous comprehensive coverage.

Combine exchange contract names such as `100X`, `1000X`, `10000X`, and `100000X` with plain `X` as the same underlying coin.

**Why:** the user explicitly wants contracts whose exchanges multiply coin units to reduce displayed zeros aggregated together, not treated as separate coins.

**How to apply:** normalize the name and per-coin price before grouping or price filtering; preserve USD OI and account ratios, and retain original contract symbols in expanded details.

The list's display name follows the majority of contributing exchanges' original coin names: two venues using `1000X` versus one using `X` must display `1000X`. A single-venue coin keeps that venue's original name.

**Why:** the user explicitly requested this naming rule while still aggregating multiplier aliases as one coin.

**How to apply:** count each venue once, not each contract. Keep canonical grouping separate from the displayed name. Tied votes use USD OI, then alphabetical order, to remain deterministic.
