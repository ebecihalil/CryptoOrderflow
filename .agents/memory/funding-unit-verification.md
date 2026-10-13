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
