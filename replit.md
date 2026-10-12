# Perpetual LSAR Screener

A live Binance and Bybit perpetual-futures screener for long-short account-ratio changes by timeframe.

## Run & Operate

- `npm run build` — bundle the React frontend into `dist/`
- `npm start` — run the Express server (`node server.js`) on `process.env.PORT` or port `10000`
- No API keys or database are required; exchange market data is fetched from Binance and Bybit.

## Stack

- Node.js 24, Express 5, React, Vite
- Single Express process serves both `/api/*` and the built frontend.

## Where things live

- `server.js` — Express API routes, server-side price filtering, and static frontend serving.
- `server/lsarMarketData.js` — exchange fetches, previous-candle LSAR calculations, and OI-weighted aggregation.
- `src/` — React screener and its styles.
- `public/` — static assets copied into the production build.

## Architecture decisions

- Binance and Bybit readings for the same asset are aggregated using USD open interest as the weight.
- Each timeframe compares the latest 5-minute observation in the current UTC-aligned candle with the latest observation in the immediately preceding candle.
- The server applies the maximum-price filter before returning screener rows; the default cap is `$5`, and the UI can request all prices.
