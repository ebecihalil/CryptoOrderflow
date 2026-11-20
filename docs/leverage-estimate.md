# Aggregated Leverage Estimate

Route: `/leverage-estimate` · API: `GET /api/indicators/leverage?asset=BTC&timeframe=1h`
(`timeframe` = 5m, 15m, 30m, 1h, 4h, 1d).

An exchange-fed upgrade of the "Perp OI Pressure + Chart Flow" Pine script.
TradingView can't combine OI with top-trader ratios and aggressor-side
(footprint) flow across venues. This module does, server-side.

## What it can and cannot measure

True average leverage is notional ÷ posted margin. **No exchange publishes
aggregate margin**, so no public dataset can measure it. The result is a
relative **0–100 Leverage Score** plus a **long/short side bias**, not an
"N× leverage" figure. "OI vs spot turnover 1.3× of normal" is relative to the
asset's own history, not a leverage multiple.

## Inputs (per venue, native history at the selected timeframe)

| Venue | OI | Spot turnover | Top-trader accounts | Top-trader positions | All accounts | Taker buy/sell | Liquidations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Binance USD-M | `openInterestHist` (500) | spot klines (binance.vision) | `topLongShortAccountRatio` | `topLongShortPositionRatio` | `globalLongShortAccountRatio` | `takerlongshortRatio` | — |
| OKX | rubik OI history (100) | spot candles | top-trader account ratio | top-trader position ratio | account ratio | `taker-volume-contract` (USD) | — |
| Gate.io | `contract_stats` (100) | spot candlesticks | `top_lsr_account` | `top_lsr_size` | `lsr_account` | — | long/short liq USD |
| Bybit | open-interest × linear close (200) | spot kline turnover | — | — | account-ratio | — | — |

Binance taker volumes are in contract-asset units and are valued at the bar's
OI-implied contract price, so 1000×-denominated contracts stay correct.

## Calculation (`server/leverageMath.js`)

1. **OI / spot-turnover pressure (35%)**: per venue, OI ÷ average spot turnover
   (`volLen` = 20 bars) is compared with that venue's own median (`lookback` =
   200 bars, min 30 bars), then OI-weighted. Doing this per venue means a venue
   joining or leaving (OKX/Gate keep 100 bars, Binance 500) cannot fake a jump.
2. **Footprint-attributed build (25%)**: the same-cohort OI change is classified
   by net taker imbalance (|imbalance| ≥ 5%): OI↑ + buying = long build,
   OI↑ + selling = short build, OI↓ + selling = long unwind, OI↓ + buying =
   short unwind. Summed over `buildWindow` = 24 bars, as % of OI.
3. **Top-trader crowding (20%)**: |OI-weighted top-trader position long share − 50%|.
4. **Size skew (20%)**: ln(position ratio ÷ account ratio). Positive = long top
   traders hold bigger size per account than short top traders.

Ratios are aggregated as OI-weighted shares (same method as LSAR), never as
averaged raw ratios. Each component is percentile-ranked against its own
lookback. The score is the weighted mean of the available components and
requires the pressure component plus at least one other. Regimes: <40 low,
40–60 normal, 60–80 elevated, ≥80 extreme.

Side bias averages net build direction, tanh(3·size skew) and top-trader
position share. ≥ +0.2 is long-heavy, ≤ −0.2 short-heavy.

Retail divergence = all-account long share − top-trader position long share.

## Requests and caching

All calls use the shared exchange gates (`requestJson`). Per refresh:
Binance 5 history + 1 spot kline, OKX 6, Gate 2, Bybit 4. Groups are per
asset/timeframe, refreshed every 2 min (5m/15m) or 5 min, evicted after 30 idle
minutes, max 8 concurrent. Requests return the cached snapshot immediately.
Failed venues keep verified bars for up to 30 min marked `cached`, then become
`unavailable`. Missing data is excluded, never zero-filled.

## Known limits

- Footprint history uses exchange-published taker buy/sell aggregates (Binance,
  OKX). It is not the app's own tick collector. Bybit/Gate flows are not included.
- Venue timestamp conventions (period start vs snapshot) are floored to the
  bar. A one-bar offset between venues is possible.
- Binance futures inputs need a supported hosting region or `BINANCE_RELAY_URL`
  (see `binance-access.md`). Without them the estimate runs on OKX/Gate/Bybit.
