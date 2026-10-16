# Aggregated Open Interest / Market Driver

The indicator adapts the user's Pine source to the app's exchange-fed native
chart. It uses the selected chart timeframe and canonical crypto asset.
Its internal perpetual CVD uses a fixed one-day anchor, matching the supplied
script.

## Inputs and sources

- OI contract quantities reuse the shared OI inventory and history collector;
  no separate symbol-wide scanner is started by a browser refresh.
- Perpetual CVD reuses the existing ten-venue executed-trade collector. The
  account-ratio direction uses verified account-ratio readings when available.
- The verified liquidation streams currently used here are Binance force-order
  snapshots and Bybit's per-symbol all-liquidation stream. Binance's stream is
  sampled, not an exhaustive tape. Exchange connections respect the existing
  request gates and cooldowns.
- Other requested venues appear as unavailable for metrics without a verified
  compatible feed. Missing sources are not counted as zero.

Open-interest candles require real samples from the same set of contracts in
both the previous and current chart interval. A changed exchange cohort starts
a new segment rather than drawing a false OI jump. No missing candles or
historical data are synthesized.

## Driver logic

The submitted script's OI/CVD/price state matrix, flat/low-activity tests,
color logic, configurable spike detection and active-peak pullback alerts are
retained in the native indicator. Its buy/sell percentage annotation is
calculated from recorded signed perpetual trade values. Account-ratio
interpretations remain heuristic labels, not verified identities.

The requested 0.5% rule adds a significance gate: a liquidation side must be at
least 0.5% of aggregated OI for that same candle, as well as satisfy the
script's relative activity test. Below the cutoff it does not trigger the
liquidation classification. Missing liquidation coverage remains unavailable,
not a no-liquidation observation.

## Known limits

- Only verified sources contribute. Current exchange coverage differs by input;
  the coverage table in the indicator reports each metric separately.
- Liquidation event history begins when a supported stream is connected. It is
  not reconstructed from CVD, price or OI candles.
- The displayed 24-hour volume uses the exchanges' rolling 24-hour turnover
  converted into underlying-coin units. A verified 20-day daily-volume series
  has not been implemented, so its display remains unavailable rather than
  estimated.
- Whale/retail annotations are the submitted script's interpretations of
  observed patterns, not proof of participant identity or trading intent.
