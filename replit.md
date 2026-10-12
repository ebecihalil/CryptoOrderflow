# Perpetual LSAR Screener

A live Binance, Bybit, OKX, Gate.io, and Bitget perpetual-futures screener for long-short account-ratio changes by timeframe.

## Run & Operate

- `npm run build` — bundle the React frontend into `dist/`
- `npm start` — run the Express server (`node server.js`) on `process.env.PORT` or port `10000`
- `npm test` — test candle matching and aggregation.
- No API keys or database are required; exchanges are queried through public market APIs.

## Stack

- Node.js 24, Express 5, React, Vite
- Single Express process serves both `/api/*` and the built frontend.

## Where things live

- `server.js` — Express API routes, server-side price filtering, and static frontend serving.
- `server/lsarMarketData.js` — exchange fetches, previous-candle LSAR calculations, and OI-weighted aggregation.
- `src/` — React screener and its styles.
- `public/` — static assets copied into the production build.

## Architecture decisions

- Readings for the same asset are aggregated using USD open interest as the weight.
- Each timeframe compares matching venues in the current and immediately preceding UTC-aligned candle with identical OI weights. OKX/Bitget fall back to hourly history for previous 4h/24h candles when their limited 5m history does not reach the previous candle.
- Bitget account data is limited to one request per second. It fills progressively, independently of other scans. All readings older than 15 minutes are excluded.
- The server applies the maximum-price filter before returning screener rows; the default cap is `$5`, and the UI can request all prices.
