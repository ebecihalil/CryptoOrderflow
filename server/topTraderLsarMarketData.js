// Aggregated TOP TRADER Long Short Account Ratio.
//
// Uses only exchanges that publish a documented top-trader ACCOUNT ratio:
//   - Binance USD-M  /futures/data/topLongShortAccountRatio?symbol=  (top 20% by margin balance)
//   - Binance COIN-M /futures/data/topLongShortAccountRatio?pair=&contractType=PERPETUAL
//   - OKX            /api/v5/rubik/stat/contracts/long-short-account-ratio-contract-top-trader
//   - Gate.io        futures contract_stats `top_lsr_account` (already fetched by the global scan)
// Bybit and Toobit publish no top-trader ratio. Bitget/HTX are not added until
// their endpoints are verified against official documentation.
//
// Contract lists, prices and USD OI weights are REUSED from the global LSAR
// scan for the same contracts, so this screener adds only one history request
// per contract (none for Gate). Calculations are identical to the global LSAR
// (OI-weighted shares, matched previous/current candles).
import { requestJson } from "./exchangeRequests.js";
import { BinanceCooldownError } from "./binanceRequestGate.js";
import { createLsarCollector, getLsarMarketSnapshot, getLsarSourceReadings } from "./lsarMarketData.js";

export const TOP_TRADER_EXCHANGES = ["binance", "okx", "gate"];
const HISTORY_LIMIT = 300;
const WAITING = { waiting: true, readings: [], marketCount: 0, errorCount: 0, error: null };

const finite = value => {
    const parsed = Number(value);
    return value === null || value === undefined || value === "" || !Number.isFinite(parsed) ? null : parsed;
};
const sortPoints = points => points.filter(point => point.timestamp > 0 && point.ratio > 0).sort((a, b) => a.timestamp - b.timestamp);

async function mapLimit(values, limit, work) {
    const results = new Array(values.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
        while (cursor < values.length) {
            const index = cursor++;
            results[index] = await work(values[index]);
        }
    }));
    return results;
}

/** Same reading shape as the global LSAR, with top-trader points instead. */
function withPoints(base, points, longWindowPoints) {
    const { topPoints: _ignored, ...rest } = base;
    return { ...rest, points, ...(longWindowPoints ? { longWindowPoints } : { longWindowPoints: undefined }) };
}

export async function fetchTopBinance({ request = requestJson, onReading = () => {}, source = getLsarSourceReadings } = {}) {
    const base = source("binance");
    if (!base.length) return WAITING;
    let errorCount = 0, fetchError = null;
    const readings = await mapLimit(base, 8, async (reading) => {
        const coinM = Boolean(reading.pair);
        const url = coinM
            ? `https://dapi.binance.com/futures/data/topLongShortAccountRatio?pair=${encodeURIComponent(reading.pair)}&contractType=PERPETUAL&period=5m&limit=${HISTORY_LIMIT}`
            : `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${encodeURIComponent(reading.symbol)}&period=5m&limit=${HISTORY_LIMIT}`;
        try {
            const history = await request(url);
            const points = sortPoints((Array.isArray(history) ? history : []).map(item => ({
                timestamp: Number(item.timestamp), ratio: finite(item.longShortRatio) ?? 0 })));
            if (!points.length) { errorCount += 1; return null; }
            const top = withPoints(reading, points);
            onReading(top);
            return top;
        } catch (error) {
            errorCount += 1;
            if (!fetchError || error instanceof BinanceCooldownError) fetchError = error;
            return null;
        }
    });
    return { readings: readings.filter(Boolean), marketCount: base.length, errorCount,
        error: fetchError ? String(fetchError.message ?? fetchError) : null };
}

export async function fetchTopOkx({ request = requestJson, onReading = () => {}, source = getLsarSourceReadings } = {}) {
    const base = source("okx");
    if (!base.length) return WAITING;
    let errorCount = 0;
    const parse = body => sortPoints((body?.data ?? []).map(([timestamp, ratio]) => ({ timestamp: Number(timestamp), ratio: finite(ratio) ?? 0 })));
    const readings = await mapLimit(base, 6, async (reading) => {
        const url = `https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio-contract-top-trader?instId=${encodeURIComponent(reading.symbol)}`;
        try {
            // 5m for short candles; hourly for previous 4h/24h candles (as the global scan does).
            const [history, hourly] = await Promise.all([request(`${url}&period=5m`), request(`${url}&period=1H`)]);
            const points = parse(history);
            if (!points.length) { errorCount += 1; return null; }
            const top = withPoints(reading, points, parse(hourly));
            onReading(top);
            return top;
        } catch { errorCount += 1; return null; }
    });
    return { readings: readings.filter(Boolean), marketCount: base.length, errorCount, error: null };
}

/** Gate: no requests; the global contract_stats response already holds top_lsr_account. */
export async function fetchTopGate({ onReading = () => {}, source = getLsarSourceReadings } = {}) {
    const base = source("gate");
    if (!base.length) return WAITING;
    const readings = base.filter(reading => reading.topPoints?.length).map(reading => withPoints(reading, reading.topPoints));
    for (const reading of readings) onReading(reading);
    return { readings, marketCount: base.length, errorCount: base.length - readings.length, error: null };
}

const topCollector = createLsarCollector({
    label: "top-trader account-ratio",
    fetchers: { binance: options => fetchTopBinance(options), okx: options => fetchTopOkx(options), gate: options => fetchTopGate(options) },
    // Keep the global scan (contract lists, prices, OI weights) scheduled even
    // when visitors only open the Top Trader page.
    beforeSnapshot: () => { getLsarMarketSnapshot(); },
});

export function getTopTraderLsarSnapshot() {
    return topCollector.getSnapshot();
}
export function getTopTraderLsarSummary(timeframe) {
    return topCollector.getSummary(timeframe);
}
