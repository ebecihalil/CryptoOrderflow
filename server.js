import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getLsarMarketSnapshot,
  getLsarMarketSummary,
} from "./server/lsarMarketData.js";

const app = express();
const port = Number(process.env.PORT || 10000);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(rootDir, "dist");
const timeframes = new Set(["5m", "15m", "30m", "1h", "4h", "24h"]);

app.disable("x-powered-by");
app.use(express.json());

app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
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

  const snapshot = getLsarMarketSnapshot();
  res.json({
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
  res.json(getLsarMarketSummary(timeframe));
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

app.listen(port, "0.0.0.0", () => {
  console.info(`Crypto Orderflow listening on port ${port}`);
});
