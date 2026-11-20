import express from "express";
import { getFundingMarketSnapshot } from "./server/fundingMarketData.js";
import { getOpenInterestSnapshot } from "./server/openInterestMarketData.js";
import { oiDriverService } from "./server/oiDriverService.js";
import { aggregatedCandleService } from "./server/aggregatedChartCandles.js";
import { fundingIndicatorService } from "./server/fundingIndicator.js";
import { cvdIndicatorService } from "./server/cvdIndicator.js";
import { chartWatchlistService } from "./server/chartWatchlist.js";
import { leverageService } from "./server/leverageService.js";
import { marketContractService } from "./server/marketContracts.js";
import { marketTickerService } from "./server/marketTickers.js";
import { binanceGeoBlocks, describeBinanceAccess } from "./server/binanceAccess.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getLsarMarketSnapshot,
  getLsarMarketSummary,
} from "./server/lsarMarketData.js";
import { getTopTraderLsarSnapshot, getTopTraderLsarSummary } from "./server/topTraderLsarMarketData.js";
import { createAccountService } from "./server/accounts.js";
import { secondCandleService } from "./server/secondCandleService.js";
import { isSecondTimeframe } from "./server/timeframes.js";
import { createAccountRouter } from "./server/accountRoutes.js";
import { getLsarChart } from "./server/lsarChart.js";
import { createPerpLeverageService } from "./server/perpLeverage.js";
import { aggregatedOiService } from "./server/aggregatedOi.js";
import { candleService } from "./server/chartCandles.js";
import { getOiChartInputs } from "./server/openInterestMarketData.js";
import { OI_DRIVER_EXCHANGES } from "./server/oiDriverService.js";

// kind=global (default): all-accounts LSAR. kind=top: top-trader accounts LSAR.
const lsarKind = (req, res) => {
  const kind = req.query.kind ?? "global";
  if (kind !== "global" && kind !== "top") {
    res.status(400).json({ error: "kind must be global or top." });
    return null;
  }
  return kind;
};

const app = express();
void chartWatchlistService.start();
const port = Number(process.env.PORT || 10000);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(rootDir, "dist");
const timeframes = new Set(["5m", "15m", "30m", "1h", "4h", "24h"]);

app.disable("x-powered-by");
// Caddy (or Render's proxy) sits in front: trust it for the client IP
// (login rate limits) and HTTPS (Secure session cookie).
app.set("trust proxy", process.env.TRUST_PROXY ?? "loopback, linklocal, uniquelocal");
app.use(express.json({ limit: "20kb" }));

// Free accounts: sign up / sign in, per-account watchlist.
const accounts = createAccountService();
app.use("/api", createAccountRouter({ accounts }));
setInterval(() => accounts.purgeExpired(), 6 * 3600_000).unref();

app.get("/api/chart/watchlist", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await chartWatchlistService.get());
});
const watchMutation = operation => async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
      return res.status(403).json({ error: "Watchlist changes must come from this app." });
    }
    res.json(await operation(req));
  } catch (error) {
    res.status([400, 409, 503].includes(error.status) ? error.status : 503)
      .json({ error: error.status ? error.message : "Watchlist could not be updated. Please retry." });
  }
};
app.post("/api/chart/watchlist", watchMutation(req => chartWatchlistService.add(req.body)));
app.delete("/api/chart/watchlist/:asset", watchMutation(req => chartWatchlistService.remove(req.params.asset)));

app.get("/api/healthz", (_req, res) => {
  // Exposes routing mode and any geo-blocked Binance hosts (no IPs or secrets).
  res.json({ status: "ok", binance: { ...describeBinanceAccess(), geoBlocked: binanceGeoBlocks.status() } });
});

app.get("/api/market/contracts", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(marketContractService.get());
});

// Market list: last price and 24h change for every Super Charts contract.
app.get("/api/market/tickers", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(marketTickerService.get());
});

app.get("/api/market/candles", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    // 1s–30s are built from live trades; 1m and above come from exchange candles.
    res.json(isSecondTimeframe(req.query.timeframe) ? await secondCandleService.get(req.query) : await aggregatedCandleService.get(req.query));
  } catch (error) {
    res.status(error.status ?? 503).json({ error: error.message, retryAt: error.retryAt });
  }
});

// Make the preferred, unminified form of the MPL-covered adaptation available.
app.get("/api/indicators/liquidity-zones/source", (_req, res) => {
  res.type("text/plain").sendFile(path.join(rootDir, "src/lib/liquidity-zones.ts"));
});

app.get("/api/indicators/funding", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(fundingIndicatorService.get(req.query)); }
  catch (error) { res.status(error.status === 400 ? 400 : 503).json({ error: error.status === 400
    ? error.message : "Funding indicator data is currently unavailable." }); }
});

app.get("/api/indicators/cvd", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(cvdIndicatorService.get(req.query)); }
  catch (error) { res.status(error.status === 400 ? 400 : 503).json({ error: error.status === 400
    ? error.message : "CVD collection is currently unavailable. Please retry later." }); }
});

app.get("/api/indicators/aggressive-bubbles", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(cvdIndicatorService.getBubbles(req.query)); }
  catch (error) { res.status(error.status === 400 ? 400 : 503).json({ error: error.status === 400
    ? error.message : "Aggressive bubbles collection is currently unavailable. Please retry later." }); }
});

app.get("/api/market/funding", (req, res) => {
  const timeframe=req.query.timeframe??"current";
  if(typeof timeframe!=="string"||!["current","1d","7d","30d","1y"].includes(timeframe)){
    res.status(400).json({error:"timeframe must be current, 1d, 7d, 30d, or 1y."});return;
  }
  res.set("Cache-Control","no-store").json(getFundingMarketSnapshot(timeframe));
});

app.get("/api/market/open-interest", (req, res) => {
  const comparison = req.query.comparison ?? "candle";
  if (!["candle", "rolling24h"].includes(comparison) ||
      (comparison === "rolling24h" && (req.query.timeframe ?? "1h") !== "24h")) {
    res.status(400).json({ error: "comparison must be candle, or rolling24h with timeframe=24h." }); return;
  }
  const timeframe = req.query.timeframe ?? "1h";
  if (typeof timeframe !== "string" || !timeframes.has(timeframe)) {
    res.status(400).json({ error: "timeframe must be one of 5m, 15m, 30m, 1h, 4h, or 24h." }); return;
  }
  const selection = req.query.exchanges;
  const allowed = new Set(["binance", "bybit", "okx", "gate", "bitget", "mexc", "kucoin", "kraken",
    "bingx", "aster", "hyperliquid", "htx", "deribit", "lighter", "paradex", "coinex", "bitmex", "cme"]);
  if (selection !== undefined && (typeof selection !== "string" || selection.split(",").some(exchange => !allowed.has(exchange)))) {
    res.status(400).json({ error: "exchanges must be a comma-separated list of supported exchange names." }); return;
  }
  res.set("Cache-Control", "no-store").json(getOpenInterestSnapshot(timeframe, selection ? [...new Set(selection.split(","))] : [], comparison));
});

// Aggregated Open Interest pane: total OI of every USDT/USDC perpetual, as chart candles (coins).
app.get("/api/indicators/aggregated-oi", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(await aggregatedOiService.get(req.query)); }
  catch (error) { res.status(error.status === 400 ? 400 : 503).json({ error: error.status === 400
    ? error.message : "Aggregated open interest is currently unavailable." }); }
});
app.get("/api/indicators/open-interest-driver", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(oiDriverService.get(req.query)); }
  catch (error) { res.status(error.status === 400 ? 400 : 503).json({ error: error.status === 400
    ? error.message : "Aggregated OI indicator inputs are currently unavailable." }); }
});

// Perp Leverage Estimation pane (×): OI cohorts calibrated to recorded liquidations; funding, perp/spot volume and taker flow as prior.
const perpLeverageService = createPerpLeverageService({ cvd: cvdIndicatorService, oiInputs: getOiChartInputs,
  candles: candleService, oiExchanges: OI_DRIVER_EXCHANGES, funding: fundingIndicatorService });
app.get("/api/indicators/perp-leverage", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(await perpLeverageService.get(req.query)); }
  catch (error) { res.status(error.status === 400 ? 400 : 503).json({ error: error.status === 400
    ? error.message : "Perp leverage estimation inputs are currently unavailable." }); }
});

// Global / Top Trader Long Short Account Ratio pane for Super Charts.
app.get("/api/indicators/lsar-chart", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(getLsarChart(req.query)); }
  catch (error) { res.status(error.status === 400 ? 400 : 503).json({ error: error.status === 400
    ? error.message : "Long/short ratio data is currently unavailable." }); }
});

app.get("/api/indicators/leverage", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(leverageService.get(req.query)); }
  catch (error) { res.status([400, 503].includes(error.status) ? error.status : 503).json({ error: [400, 503].includes(error.status)
    ? error.message : "Leverage estimate inputs are currently unavailable." }); }
});

app.get("/api/market/lsar", (req, res) => {
  const rawMaxPrice = req.query.maxPrice;
  let maxPrice = 5;

  if (rawMaxPrice === "all") {
    maxPrice = null;
  } else if (rawMaxPrice !== undefined) {
    if (typeof rawMaxPrice !== "string" || rawMaxPrice.trim() === "") {
      res.status(400).json({ error: "maxPrice must be a non-negative number or 'all'." });
      return;
    }
    const parsed = Number(rawMaxPrice);
    if (!Number.isFinite(parsed) || parsed < 0) {
      res.status(400).json({ error: "maxPrice must be a non-negative number or 'all'." });
      return;
    }
    maxPrice = parsed;
  }

  const kind = lsarKind(req, res);
  if (!kind) return;
  const snapshot = kind === "top" ? getTopTraderLsarSnapshot() : getLsarMarketSnapshot();
  res.json({
    kind,
    ...snapshot,
    rows: snapshot.rows.filter((row) => maxPrice === null || row.price <= maxPrice),
  });
});

app.get("/api/market/summary", (req, res) => {
  const timeframe = req.query.timeframe;
  if (typeof timeframe !== "string" || !timeframes.has(timeframe)) {
    res.status(400).json({ error: "timeframe must be one of 5m, 15m, 30m, 1h, 4h, or 24h." });
    return;
  }
  const kind = lsarKind(req, res);
  if (!kind) return;
  res.json({ kind, ...(kind === "top" ? getTopTraderLsarSummary(timeframe) : getLsarMarketSummary(timeframe)) });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

app.use(express.static(staticDir, { index: false }));

app.get(/.*/, (_req, res, next) => {
  res.sendFile(path.join(staticDir, "index.html"), (error) => {
    if (error) next(error);
  });
});

const httpServer = app.listen(port, "0.0.0.0", () => {
  console.info(`Crypto Orderflow listening on port ${port}`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  httpServer.close();
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  await chartWatchlistService.close();
  await cvdIndicatorService.close();
  accounts.close();
  clearTimeout(deadline);
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
