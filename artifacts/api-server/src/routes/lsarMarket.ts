import { Router, type IRouter } from "express";
import {
  GetLsarMarketSnapshotResponse,
  GetLsarMarketSummaryQueryParams,
  GetLsarMarketSummaryResponse,
} from "@workspace/api-zod";
import {
  getLsarMarketSnapshot,
  getLsarMarketSummary,
} from "../lib/lsarMarketData";

const router: IRouter = Router();

router.get("/market/lsar", (_req, res): void => {
  res.json(GetLsarMarketSnapshotResponse.parse(getLsarMarketSnapshot()));
});

router.get("/market/summary", (req, res): void => {
  const params = GetLsarMarketSummaryQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  res.json(GetLsarMarketSummaryResponse.parse(getLsarMarketSummary(params.data.timeframe)));
});

export default router;
