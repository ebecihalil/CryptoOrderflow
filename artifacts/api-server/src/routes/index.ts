import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lsarMarketRouter from "./lsarMarket";

const router: IRouter = Router();

router.use(healthRouter);
router.use(lsarMarketRouter);

export default router;
