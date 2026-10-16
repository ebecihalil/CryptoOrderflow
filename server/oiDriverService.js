import { canonicalAsset } from "./lsarMarketData.js";
import { weightedAccountRatio } from "./lsarAggregation.js";
import { getOiChartInputs } from "./openInterestMarketData.js";
import { getLsarChartReadings } from "./lsarMarketData.js";
import { cvdIndicatorService } from "./cvdIndicator.js";
import { OI_WINDOWS } from "./openInterestMath.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { marketContractService } from "./marketContracts.js";
import { buildOiDriverCandles } from "./oiDriverMath.js";

export const OI_DRIVER_EXCHANGES = ["binance", "bybit", "okx", "gate", "mexc", "bitget", "bingx", "kucoin", "kraken", "htx"];
const MAX_CANDLES = 1_500;

function validateQuery(query, catalogue = marketContractService) {
  const asset = typeof query.asset === "string" ? canonicalAsset(query.asset).asset : "";
  const timeframe = query.timeframe ?? "1h";
  const exchange = query.exchange, symbol = query.symbol;
  if (!/^[A-Z0-9]{1,30}$/.test(asset) || !isCryptoAsset(asset) ||
      !Object.hasOwn(OI_WINDOWS, timeframe) || typeof exchange !== "string" ||
      typeof symbol !== "string" || !/^[A-Z0-9_-]{2,45}$/.test(symbol)) {
    throw Object.assign(new Error("A verified crypto contract and supported chart timeframe are required."), { status: 400 });
  }
  const snapshot = catalogue.get();
  const contract = snapshot.contracts.find(item => item.exchange === exchange && item.symbol === symbol && item.asset === asset);
  if (!contract) throw Object.assign(new Error("The selected chart contract is not in the verified live catalogue."), {
    status: snapshot.isRefreshing ? 503 : 400,
  });
  return { asset, timeframe, exchange, symbol, contract };
}

function weightedLsarBars(oiBars, readings, contracts, durationMs) {
  let prior = null, priorCohort = "";
  return oiBars.map(bar => {
    const end = bar.time * 1000 + durationMs;
    const pieces = [];
    for (const reading of readings) {
      const ratioPoint = [...reading.points].reverse().find(point =>
        point.timestamp <= end && point.timestamp >= end - durationMs);
      if (!ratioPoint || !(ratioPoint.ratio > 0)) continue;
      // Exchange tickers can differ by 100x/1,000x denominations; both
      // screener feeds already expose the verified canonical underlying asset.
      const inventory = contracts.find(item => item.exchange === reading.exchange && item.asset === reading.asset);
      const oiPoint = inventory?.points.filter(point => point.timestamp <= ratioPoint.timestamp)
        .at(-1);
      if (oiPoint && end - oiPoint.timestamp <= 15 * 60_000 && oiPoint.oiCoin > 0) {
        pieces.push({ ratio: ratioPoint.ratio, weight: oiPoint.oiCoin, exchange: reading.exchange });
      }
    }
    const cohort = pieces.map(item => item.exchange).sort().join("|");
    const ratio = weightedAccountRatio(pieces);
    const direction = ratio !== null && prior !== null && cohort === priorCohort
      ? Math.sign(ratio - prior) : 0;
    if (ratio !== null) { prior = ratio; priorCohort = cohort; }
    return { ...bar, lsarDirection: direction };
  });
}

export function createOiDriverService({
  oiInputs = getOiChartInputs, cvd = cvdIndicatorService,
  lsar = getLsarChartReadings, catalogue = marketContractService, now = Date.now,
} = {}) {
  function get(query) {
    const parsed = validateQuery(query, catalogue);
    const duration = OI_WINDOWS[parsed.timeframe];
    const oiData = oiInputs(parsed.asset, OI_DRIVER_EXCHANGES);
    // The supplied Pine source uses a fixed 1-day CVD anchor.
    // Reuse the shared 10-venue collector and its sampled liquidation stream.
    const flow = cvd.get({ asset: parsed.asset, market: "perpetual", timeframe: parsed.timeframe, anchor: "1d" });
    const liquidation = cvd.liquidationSnapshot(parsed.asset);
    const accountRatios = lsar(parsed.asset, OI_DRIVER_EXCHANGES);
    const bars = weightedLsarBars(
      buildOiDriverCandles(oiData.contracts, duration, now()),
      accountRatios,
      oiData.contracts,
      duration,
    );
    const cvdBars = new Map(flow.candles.map(item => [item.time, item]));
    const liquidationByTime = new Map();
    for (const event of liquidation.events) {
      const time = Math.floor(event.time / duration) * duration;
      if (!liquidationByTime.has(time)) liquidationByTime.set(time, { long: 0, short: 0 });
      const sides = liquidationByTime.get(time);
      sides[event.side] += event.usd;
    }
    const result = bars.map(bar => {
      const flowBar = cvdBars.get(bar.time);
      const liquidations = liquidationByTime.get(bar.time);
      const observedForWholeBar = liquidation.coverage.some(source => source.since <= bar.time * 1000);
      return { ...bar, cvd: flowBar ? {
        open: flowBar.open, high: flowBar.high, low: flowBar.low, close: flowBar.close,
        buyValue: flowBar.buyValue, sellValue: flowBar.sellValue,
      } : null, longLiqUsd: liquidations?.long ?? (observedForWholeBar ? 0 : null),
        shortLiqUsd: liquidations?.short ?? (observedForWholeBar ? 0 : null),
        oiUsd: oiData.contracts.reduce((sum, item) => sum + (item.oiUsd || 0), 0) };
    }).slice(-MAX_CANDLES);
    const oiUsd = oiData.contracts.reduce((sum, item) => sum + (item.oiUsd || 0), 0);
    const oiCoin = oiData.contracts.reduce((sum, item) => sum + (item.oiCoin || 0), 0);
    const dailyVolumeCoin = oiData.contracts.reduce((sum, item) => {
      const price = item.markPrice > 0 ? item.markPrice / (item.priceDivisor || 1) : 0;
      return sum + (item.volume24hUsd > 0 && price > 0 ? item.volume24hUsd / price : 0);
    }, 0);
    const sources = OI_DRIVER_EXCHANGES.map(exchange => {
      const inventory = oiData.sources.find(source => source.exchange === exchange);
      const trade = flow.sources.find(source => source.exchange === exchange);
      const liq = liquidation.sources.find(source => source.exchange === exchange);
      const lsarSource = accountRatios.find(source => source.exchange === exchange);
      const count = oiData.contracts.filter(item => item.exchange === exchange).length;
      return { exchange,
        oi: count ? `${count} current contract${count === 1 ? "" : "s"} · ${inventory?.status ?? "snapshot"}` : "Unavailable",
        cvd: trade ? `${trade.status}${trade.tradeCount ? ` · ${trade.tradeCount} trades` : ""}` : "Unavailable",
        liquidations: liq?.status ?? "Unavailable",
        lsar: lsarSource ? "Verified account-ratio history" : "Unavailable" };
    });
    const warnings = [
      "Observed OI candles require contemporaneous contract samples; venue membership changes create a segment break, not a fabricated jump.",
      "Daily volume is the current rolling-24h exchange volume converted to underlying-coin units. The 20-day average is unavailable until verified daily history is implemented; it is not estimated.",
      "Liquidations are an observed-only subset: Binance's stream reports a sampled liquidation snapshot and Bybit's stream is per selected symbol. A zero is used only for a full bar while at least one supported socket was connected; other sources/history are unavailable, not zero.",
      "The user's 0.5% liquidation threshold compares observed side value to aggregated OI in the same chart bar. It is a classification cutoff, not proof no liquidation occurred.",
      ...flow.warnings,
    ];
    if (flow.sources.some(source => source.status !== "live")) warnings.push("Perpetual CVD coverage is partial or still collecting; missing exchange flow is never zero-filled.");
    return {
      asset: parsed.asset, exchange: parsed.exchange, symbol: parsed.symbol, timeframe: parsed.timeframe,
      candles: result, cvdSources: flow.sources, sources, warnings,
      totals: { oiCoin, oiUsd, dailyVolumeCoin, average20dVolumeCoin: null },
      generatedAt: new Date(now()).toISOString(), isRefreshing: oiData.refreshing || flow.isLoading,
    };
  }
  return { get };
}

export const oiDriverService = createOiDriverService();
