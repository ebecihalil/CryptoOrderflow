---
name: Funding OI unit verification
description: Why rate/OI adapters must verify linear, inverse and quote/payment bases independently.
---

Verify USD OI conversions separately for inverse and linear contracts before
admitting a venue into the global OI denominator. Do not infer units from a field
name or reuse an apparently similar exchange's formula.

**Why:** initial funding verification produced a multi-trillion-dollar denominator
when MEXC inverse USD contract face values were multiplied by mark price a second
time. Bybit inverse openInterestValue is base-coin value, unlike linear USD value;
its newer single-sided fields must also be distinguished from both-sided fields.

**How to apply:** test both contract types with known face values and inspect the
largest OI contributors in a live snapshot before trusting global cutoff results.
Funding quote interval and actual settlement frequency can differ (continuous
funding); an unverified basis must not contribute a normalized funding value.

Funding must follow the same multiplier-contract grouping and naming policy as LSAR.

**Why:** the user explicitly wants 100X, 1000X, 10000X, 100000X and plain X
treated as the same coin when aggregating, rather than fragmented exchange rows.

**How to apply:** share the canonical identity/naming policy across the two
sections; provider-converted USD OI and funding percentages must not be rescaled
again merely because the contract name has a multiplier prefix.
