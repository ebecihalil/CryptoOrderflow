# Crypto Orderflow

Crypto Orderflow is the umbrella project name: the product will not be limited to LSAR. Keep LSAR as the current screener feature, not the name of the entire application.

The LSAR screen's visible header is **Long Short Account Ratio** with the **LS** mark and **Perpetual Markets** subtitle. Renaming the project/repository does not mean replacing section branding with the umbrella product name.

The LSAR section has two tabs: **Global Long Short Account Ratio** (`/long-short-account-ratio`, all accounts, six exchanges) and **Top Trader Long Short Account Ratio** (`/top-trader-long-short-account-ratio`, TT mark; Binance, OKX, Gate.io). See `docs/lsar-aggregation.md`.

Every coin section (Global/Top Trader LSAR, Funding, Open Interest, Leverage, Super Charts) shows the visitor's **recent coins** (per section, last 8) and a **personal watchlist** (star toggle, shared across sections, "Watchlist only" filter on tables). Recent coins are stored in the visitor's browser; the watchlist requires a free account (sign up / sign in) and is stored per account on the server. See `docs/accounts.md`. Super Charts' existing server watchlist (shared background recording) is separate.

The home page is the **Crypto Order Flow** module directory. Long Short Account Ratio, Funding Rate and Open Interest are live screeners. Super Charts (Indicators) uses one native exchange-fed chart with technical overlays, Liquidity Zones and synchronized funding panes, not a hosted TradingView widget. Position Ratio is removed; Liquidations and CVD remain placeholders but are hidden from the home page. Keep the existing visual concept, shared header, light/dark themes, and two-letter section marks. See `docs/super-charts.md` and `docs/liquidity-zones.md` for chart behavior.

Liquidity Zones defaults to summed Binance/OKX/Gate.io/Bybit USDT-perpetual volume
in underlying-coin units while keeping the selected exchange's OHLC prices.
The original single-exchange volume remains selectable. Cross-venue history must
use matched timestamps and stable source coverage, with no missing-bar zero-fill.
All calls use the shared exchange request gates; never fetch providers from React.

Orderflow Indicators also includes Aggregated Funding Rate with Simple Mean,
Median and OI-Weighted live values. Its settled history supports mean/median;
weighted history is recorded from contemporaneous live snapshots, not today's
OI applied retrospectively. It reuses all verified funding-provider inventory
without changing the Funding screener's global cutoff. See
`docs/funding-indicator.md` for data limitations and local-cache retention.

Super Charts combines technical/orderflow indicators in one app-native chart,
with separate selection dropdowns, a shared timeframe, and seven-venue contract
autocomplete. Native prices are independent of aggregate-volume availability.
Funding/LSAR predictive search uses existing snapshots.
See `docs/chart-workspace.md` for native candle adapters and request protections.

Leverage Estimate (`/leverage-estimate`) combines per-venue OI/spot-turnover
pressure, footprint-attributed OI build (taker buy/sell), and top-trader account
and position ratios into a relative 0–100 score and long/short side bias. It is
an estimate, not measured leverage. See `docs/leverage-estimate.md`.

Binance refuses restricted regions (HTTP 451, e.g. US hosting). Spot data uses
binance.vision; futures need a supported region or `BINANCE_RELAY_URL`
(`scripts/binance-relay.js`). See `docs/binance-access.md`.

Leave the home page area below the module navigation empty for now: the user intends to fill it with other information later, rather than adding content there ahead of that request.

The current feature is a live Binance, Bybit, OKX, Gate.io, Bitget, and Toobit perpetual-futures screener for long-short account-ratio changes by timeframe.

## Exchange rules for all future sections

- Respect each exchange's documented request limits throughout the entire website, including future order-flow sections and newly added exchanges. Review the rules for every endpoint before integrating it.
- Share each exchange's IP-wide request/weight budgets and cooldowns across all modules; do not give LSAR, Open Interest, Funding Rate, or other sections independent allowances that collectively exceed the exchange's limits. Also enforce endpoint-specific limits where applicable.
- Exchange support is specific to the metric, not restricted to the LSAR exchange list. LSAR is available from fewer exchanges; Open Interest should support more exchanges where compatible data is available.
- Keep these protections in place as the website expands, including queued requests, retries, and overlapping module updates.

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

- Funding Rate uses a >=1% exchange-wide share of observed fetched USD perpetual OI, not a per-coin cutoff. Compare current quotes on a common 8h basis and display native rates/variable intervals. Historical TFs sum actual settled funding, with current OI weights only from complete-history venues.
- Do not extrapolate a current funding quote into historical totals or hide a provider's history-retention limit.

- Readings for the same asset are aggregated using USD open interest as the weight.
- Each timeframe compares matching venues in the current and immediately preceding UTC-aligned candle with identical OI weights. OKX/Bitget fall back to hourly history for previous 4h/24h candles when their limited 5m history does not reach the previous candle.
- Bitget account data is limited to one request per second. It fills progressively, independently of other scans. All readings older than 15 minutes are excluded.
- The LSAR page has no maximum-price control and explicitly requests all prices. The API retains its optional server-side price filter and legacy default `$5` for compatibility with other callers; `maxPrice=all` disables it.
