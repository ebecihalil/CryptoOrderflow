---
name: Toobit metadata naming caveat
description: Why Toobit's baseAsset must not be treated like Binance's underlying ticker.
---

Toobit's exchange metadata can return the complete contract symbol in `baseAsset` (observed `BTC-SWAP-USDT`, not `BTC`, on 2026-10-13).

**Why:** assuming the field has the same meaning as Binance/Bybit would prevent cross-exchange grouping and multiplier-alias aggregation.

**How to apply:** verify the actual metadata response when changing symbol extraction. Preserve the original coin portion of the swap symbol for display naming; do not blindly generalize another venue's `baseAsset` mapping.
