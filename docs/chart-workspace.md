# Native chart workspace

The user replaced the hosted TradingView integration with one app-native
exchange-fed chart so technical and custom orderflow studies work together.
No external chart iframe, Pine runtime or proprietary chart SDK is used.

## Verified contracts and feed boundaries

The cached `/api/market/contracts` catalogue lists active crypto USDT perpetuals
from Binance, Bybit, OKX, Gate.io, MEXC, Bitget and BingX. Search is local; typing
does not trigger a provider request. Each suggestion includes the native
contract and venue. Choosing a market passes its native symbol to candle APIs
and its canonical underlying asset to funding aggregation.

Price candles always come from the selected venue. Aggregate-volume loading is
independent: losing a volume source must not remove valid price/technical data.
Volume is never silently replaced by another basis or zero-filled.

Native base-volume conversions:
- OKX uses `volCcy`, not contract-count or quote-dollar volume.
- Gate and MEXC contract volumes use verified contract-size metadata.
- Bitget and BingX use base volume.
- Multiplier contracts retain native prices while aggregate traded volume is
  normalized to underlying-coin units.

All seven metadata/candle adapters use shared request gates, caches, coalescing,
cooldowns and failure backoff. Refresh cannot bypass those protections.
History depth varies: OKX's selected price endpoint supplies up to 300 bars;
the other selected venue requests supply up to 1,000. Actual warmup/qualified
coverage is disclosed; unavailable older candles are never fabricated.

## Shared chart behavior

EMA/SMA/Bollinger and liquidity zones overlay price; volume, RSI, MACD and
funding occupy panes of the same chart instance and time axis. Technical
periods are validated before application. Funding requests stop when its layer
is disabled. Weighted plots use recorded-live data and disclose fallback.
Funding history is clipped to the selected price history, and null values
remain gaps. Neither cached old-coin payloads nor old hover values may appear
as a newly selected market.

Theme observers, resize observers, chart events and pending animation frames
are cleaned up. User zoom is retained on polling and indicator toggles.
The chart retains its open-source attribution but has no hosted TradingView
application or TradingView data dependency.
