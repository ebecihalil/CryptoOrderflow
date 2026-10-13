import { OI_WINDOWS } from "./openInterestMath.js";
import { canonicalAsset } from "./lsarMarketData.js";
import { number } from "./fundingMath.js";

export function hasOiBackfill(item) {
    return (item.exchange === "binance" && item.symbol.endsWith("USDT")) ||
        (item.exchange === "binance" && item.symbol.endsWith("USDC")) ||
        (item.exchange === "bybit" && /(?:USDT|USDC)$/.test(item.symbol)) ||
        (item.exchange === "gate" && item.symbol.endsWith("_USDT") && item.contractSizeCoin > 0);
}
export function mergeOiPoints(existing, incoming, now) {
    // Keep native 5m observations AND real sampled quotes. A 384-point cap
    // would truncate a 24h baseline once both streams filled the same window.
    return [...new Map([...existing, ...incoming]
        .filter(point => Number.isFinite(point.timestamp) && point.timestamp <= now &&
            now - point.timestamp <= 30 * 3600_000 && Number.isFinite(point.oiCoin) && point.oiCoin >= 0)
        .map(point => [point.timestamp, point])).values()].sort((a, b) => a.timestamp - b.timestamp).slice(-768);
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

// One complete backfill serves every candle TF AND rolling 24h; no per-TF scans.
export async function fetchOiHistoryWindow(request, item, now, hours = 30) {
    const start = now - hours * 3600_000;
    const divisor = canonicalAsset(item.exchangeAsset).priceDivisor;
    const scaled = (value, scale) => number(value) === null ? null : number(value) * scale;
    const raw = [];
    if (item.exchange === "binance") {
        const result = await request(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${encodeURIComponent(item.symbol)}&period=5m&startTime=${start}&endTime=${now}&limit=500`);
        if (!Array.isArray(result)) throw new Error("Invalid Binance OI history");
        raw.push(...result.map(point => ({ timestamp: number(point.timestamp), oiCoin: scaled(point.sumOpenInterest, divisor) })));
    } else {
        // Conservative chunk sizes: <=180 Bybit points, <=84 Gate points.
        const span = (item.exchange === "bybit" ? 15 : 7) * 3600_000;
        for (let from = start; from < now; from += span) {
            const to = Math.min(now, from + span - 1);
            if (item.exchange === "bybit") {
                const result = await request(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${encodeURIComponent(item.symbol)}&intervalTime=5min&startTime=${from}&endTime=${to}&limit=200`);
                if (!Array.isArray(result.result?.list)) throw new Error("Invalid Bybit OI history");
                raw.push(...result.result.list.map(point => ({ timestamp: number(point.timestamp),
                    oiCoin: scaled(number(point.singleOpenInterest) ??
                        (number(point.openInterest) !== null ? number(point.openInterest) / 2 : null), divisor) })));
            } else if (item.exchange === "gate" && item.contractSizeCoin > 0) {
                const result = await request(`https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${encodeURIComponent(item.symbol)}&from=${Math.floor(from / 1000)}&interval=5m&limit=100`);
                if (!Array.isArray(result)) throw new Error("Invalid Gate OI history");
                raw.push(...result.map(point => ({ timestamp: number(point.time) === null ? null : number(point.time) * 1000,
                    oiCoin: scaled(point.open_interest, item.contractSizeCoin * divisor / 2) })));
            } else throw new Error("This venue builds OI history from collected snapshots");
        }
    }
    return [...new Map(raw.filter(point => Number.isFinite(point.timestamp) && point.timestamp >= start &&
        point.timestamp <= now && Number.isFinite(point.oiCoin) && point.oiCoin >= 0)
        .map(point => [point.timestamp, point])).values()].sort((a, b) => a.timestamp - b.timestamp);
}
