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
