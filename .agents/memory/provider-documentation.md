---
name: Provider documentation redirects
description: Avoid mistaking migrated documentation landing pages for verified endpoint limits.
---

Verify that a fetched official documentation page actually describes the endpoint
being used, rather than trusting a successful HTTP response or familiar URL.

**Why:** during the 2026-10-13 request-limit review, Binance's non-legacy account-ratio
URL redirected to a combined reference, while several Bitget classic URLs returned
the UTA introduction. Repeated URL variants did not establish the classic endpoint's
current documentation. An official search-index excerpt is useful supporting
evidence, but is not equivalent to a freshly retrieved endpoint reference.

**How to apply:** inspect the page's endpoint path, metric definition and quota scope.
Binance's legacy account-ratio reference exposed the specific history-request limit.
Use legacy links where applicable, disclose evidence gaps, and never substitute a
position/top-trader/UTA metric just to obtain a working documentation page.
For unpublished endpoint-specific limits, use conservative pacing and server quota
signals without claiming that the exact endpoint ceiling has been verified.
