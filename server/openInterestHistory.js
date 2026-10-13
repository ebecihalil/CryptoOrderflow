import { OI_WINDOWS } from "./openInterestMath.js";
import { canonicalAsset } from "./lsarMarketData.js";
import { number } from "./fundingMath.js";

export function hasOiBackfill(item) {
    return (item.exchange === "binance" && item.symbol.endsWith("USDT")) ||
        (item.exchange === "binance" && item.symbol.endsWith("USDC")) ||
        (item.exchange === "bybit" && /(?:USDT|USDC)$/.test(item.symbol)) ||
        (item.exchange === "gate" && item.symbol.endsWith("_USDT") && item.contractSizeCoin > 0);
}
export async function fetchOiHistory(request, item, timeframe, now) {
    const boundary = Math.floor(now / OI_WINDOWS[timeframe]) * OI_WINDOWS[timeframe];
    const start = boundary - 300_000, divisor = canonicalAsset(item.exchangeAsset).priceDivisor;
    let raw, quantity;
    const scaled = (value, scale) => number(value) === null ? null : number(value) * scale;
    if (item.exchange === "binance") {
        raw = await request(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${encodeURIComponent(item.symbol)}&period=5m&startTime=${start}&endTime=${now}&limit=500`);
        if (!Array.isArray(raw)) throw new Error("Invalid Binance OI history");
        quantity = point => scaled(point.sumOpenInterest, divisor);
    } else if (item.exchange === "bybit") {
        const ranges = [[start, boundary - 1, 2], [Math.max(boundary, now - 600_000), now, 3]];
        raw = [];
        for (const [from, to, limit] of ranges) {
            const response = await request(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${encodeURIComponent(item.symbol)}&intervalTime=5min&startTime=${from}&endTime=${to}&limit=${limit}`);
            if (!Array.isArray(response.result?.list)) throw new Error("Invalid Bybit OI history");
            raw.push(...response.result.list);
        }
        // Bybit documents openInterest as BOTH sides; current inventory is single-sided.
        quantity = point => scaled(number(point.singleOpenInterest) ??
            (number(point.openInterest) !== null ? number(point.openInterest) / 2 : null), divisor);
    } else if (item.exchange === "gate") {
        raw = [];
        for (const [from, to, limit] of [[start, boundary - 1, 2], [Math.max(boundary, now - 600_000), now, 3]]) {
            const response = await request(`https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${encodeURIComponent(item.symbol)}&from=${Math.floor(from / 1000)}&to=${Math.floor(to / 1000)}&interval=5m&limit=${limit}`);
            if (!Array.isArray(response)) throw new Error("Invalid Gate OI history");
            raw.push(...response.map(point => ({ ...point, timestamp: number(point.time) * 1000 })));
        }
        // Gate stats count both long and short positions; contract.position_size
        // used by the current inventory is single-sided. Match that basis.
        quantity = point => scaled(point.open_interest, item.contractSizeCoin * divisor / 2);
    } else throw new Error("This venue builds OI history from collected snapshots");
    return raw.filter(point => number(point.timestamp) !== null && number(point.timestamp) <= now)
        .map(point => ({ timestamp: number(point.timestamp), oiCoin: quantity(point) }))
        .filter(point => Number.isFinite(point.oiCoin) && point.oiCoin >= 0);
}
