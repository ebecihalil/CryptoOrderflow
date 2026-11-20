import { secondCandleRecorder } from "./secondCandles.js";
import { cvdIndicatorService } from "./cvdIndicator.js";
import { marketContractService } from "./marketContracts.js";
import { isSecondTimeframe } from "./timeframes.js";
import { validateCandleQuery } from "./chartCandles.js";

/**
 * /api/market/candles for 1s/5s/15s/30s: candles built from the selected
 * contract's live trades. Starts the shared trade collector for the asset on
 * demand (same connection limits as CVD) and records only while viewed.
 */
export function createSecondCandleService({ recorder = secondCandleRecorder, cvd = cvdIndicatorService,
  catalogue = marketContractService, now = Date.now } = {}) {
  async function get(query) {
    const timeframe = query.timeframe;
    if (!isSecondTimeframe(timeframe)) throw Object.assign(new Error("Unsupported seconds timeframe."), { status: 400 });
    const { exchange, symbol } = validateCandleQuery({ ...query, timeframe: "1m" });
    const contract = catalogue.get().contracts.find(item => item.exchange === exchange && item.symbol === symbol);
    if (!contract) throw Object.assign(new Error("The selected contract is not in the verified live catalogue."), { status: 400 });
    // Keep the asset's perpetual trade collector running while seconds are viewed.
    let feed;
    try { feed = cvd.get({ asset: contract.asset, market: "perpetual", timeframe: "1m", anchor: "1d" }); }
    catch (error) { throw Object.assign(new Error(error.message || "Live trade collection is busy. Please retry shortly."), { status: 503 }); }
    const source = feed.sources.find(item => item.exchange === exchange);
    if (source?.symbol && source.symbol !== symbol)
      throw Object.assign(new Error(`Seconds candles come from the live trade stream, which covers ${source.symbol} on ${exchange}. Select that contract, or use 1m and above.`), { status: 400 });
    recorder.watch(exchange, symbol, contract.priceDivisor || 1);
    const data = recorder.candles(exchange, symbol, timeframe);
    return {
      exchange, symbol, asset: contract.asset, priceDivisor: contract.priceDivisor || 1, timeframe,
      candles: data.candles, fetchedAt: new Date(now()).toISOString(), stale: false, volumeMode: "single",
      liveTrades: true, recordingSince: data.since, sourceStatus: source?.status ?? "connecting",
      note: "Seconds candles are built from live executed trades since recording started (kept 2 hours). Seconds without trades have no candle.",
    };
  }
  return { get };
}
export const secondCandleService = createSecondCandleService();
