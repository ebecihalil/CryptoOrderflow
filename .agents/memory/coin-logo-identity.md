---
name: Coin logo identity
description: Why broad ticker logo catalogs require identity checks and must not create market-data traffic.
---

Do not resolve duplicate cryptocurrency symbols by selecting the first or highest-ranked
search result. Verify the project using its full name and exchange listing or a reviewed
stable catalog identity.

**Why:** the screener includes newer tokens that reuse old crypto symbols, and Funding
also contains equity/commodity contracts. A successful image response can still be an
unrelated token's logo (for example, ETN can represent an equity rather than Electroneum).

**How to apply:** keep unresolved identities neutral, distinguish non-crypto instruments,
and verify logo aliases without changing market grouping or calculations. Shipped logo
metadata is maintained separately from live market scans so viewing or refreshing logos
does not spend exchange request quotas.
