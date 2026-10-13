---
name: Crypto-only screener scope
description: Exclude stocks and ETFs from LSAR and Funding, and keep OI rankings crypto-only.
---
Exclude stocks and ETFs from the LSAR and Funding Rate screens as well as the
crypto-only Open Interest rankings.

**Why:** the user said “if you can exclude etf and stocks from LSAR and Funding
rate too would be awesome”; they previously stated they do not trade stocks.

**How to apply:** filter before displayed aggregation/ranking, including
multiplier-prefixed and tokenized-stock names. Do not use the price cutoff as an
asset-class classifier: inexpensive stocks are still stocks and expensive crypto
is still crypto. Preserve the independent user-selected price filter.

Use verified crypto identities rather than trusting every unknown ticker.
Unknown new identities are withheld until verified; disclose that limitation.

**Why:** stock and ETF listings include many ordinary names without a `STOCK`
suffix, so a short blacklist or $5 cap cannot reliably keep the screens crypto-only.
Crypto metadata catalogues can also include tokenized financial securities
(such as SOXX); catalogue membership alone is not proof of a crypto-only underlying.

**How to apply:** maintain local identity metadata and verified aliases without
adding market API traffic to normal page requests. Do not guess duplicate-ticker
identities from a stock name alone. Financial-security exclusions must take
precedence over crypto-logo identity matches. Use explicit provider stock/ETF
categories and verified identity IDs; broad matches like `rootstock` or
`stock-memes` do not make a cryptocurrency a stock.
