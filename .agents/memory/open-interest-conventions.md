---
name: Open Interest metric conventions
description: CME daily inclusion and cross-exchange size/change comparability decisions.
---
Include CME's latest authorized daily OI report in aggregated OI totals, and
identify its report date. Do not turn daily report changes into intraday changes.

**Why:** the user explicitly selected “Include CME in aggregated OI” after being
told that public CME OI is daily rather than live crypto-exchange data.

**How to apply:** keep daily CME inclusion in totals distinct from TF change
comparisons and rolling 24-hour volume. CME's website explicitly rejected
automated scraping; use an authorized report/feed, not website-scraping retries
or a hardcoded research snapshot.

Express aggregated contract size in equivalent underlying-coin units rather than
adding incompatible raw exchange contract counts. Sum OI rather than OI-weighting it.

**Why:** regular, Micro, inverse and multiplier-prefixed contracts have different
face sizes; weighting or simply summing their counts would misrepresent exposure.

**How to apply:** preserve the shared multiplier-asset naming rules, show the
underlying coin as the size unit, and compare the same contracts on both sides of
TF changes. Missing histories/units must remain unavailable rather than becoming
zero or a synthetic percentage.

A widespread apparent OI drop near 50% is a warning to verify one-sided versus
two-sided units before treating it as a market event.

**Why:** live validation found that Bybit's documented historical `openInterest`
contains both sides, unlike its single-sided fields. Gate's historical total
also differed from the current position-size basis by roughly a factor of two.

**How to apply:** verify the current and historical definitions independently,
prefer explicitly single-sided fields, and test that unchanged exposure stays
unchanged after conversion. Reference:
https://bybit-exchange.github.io/docs/v5/market/open-interest

Top OI gainers and losers use rolling 24-hour coin-equivalent quantity changes,
not daily candle changes, and include verified crypto only (no stocks/ETFs).
They remain independent of the selected table TF; the table's 24h option must
share the rankings' rolling snapshot, while shorter TFs remain candle-based.
Keep TF controls below ranking panels and
all methodology/explanation notes below the rest of the page.

**Why:** the user requested fixed 24-hour rankings and explanations out of the
middle of the screen, then approved rolling crypto-only rankings after incomplete
coverage and stock/ETF leaders made the earlier rankings misleading.
The user subsequently approved using the same rolling 24h data for the table
after BLUR showed a large rolling gain but a small daily-candle change.

**How to apply:** changing the table TF must not recalculate, relabel or hide
the daily rankings. Retain exchange selection and shared rate-limit protection.
For 24h, share the actual query result with the rankings, including loading,
errors, retries and refresh, rather than separately fetching equivalent
snapshots that can update at different moments.
Show matched-history coverage; do not imply partially matched coins represent
complete cross-exchange coverage or reproduce another site's USD OI metric.

Background history collection must drain fairly without depending on an open
browser. Do not claim local disk is durable on an ephemeral host.

**Why:** a page-poll-driven, largest-first backfill repeatedly left small assets
without baselines. Local history cannot survive an external host discarding disk.

**How to apply:** deduplicate shared history across TFs, let bounded workers
continue queued jobs, and retain rate gates. Preserve real baselines in available
storage; explain any separately required persistent host storage.
