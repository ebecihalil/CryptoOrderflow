import { canonicalAsset, selectDisplayAsset } from "./lsarMarketData.js";
import { isCryptoAsset } from "./cryptoAssets.js";

export const FUNDING_WINDOWS = { current: 0, "1d": 86400_000, "7d": 7 * 86400_000, "30d": 30 * 86400_000, "1y": 365 * 86400_000 };
export const FUNDING_LABELS = {
    binance: "Binance", bybit: "Bybit", okx: "OKX", gate: "Gate.io", bitget: "Bitget", toobit: "Toobit",
    mexc: "MEXC", kucoin: "KuCoin", kraken: "Kraken", bingx: "BingX", hyperliquid: "Hyperliquid",
    htx: "HTX", deribit: "Deribit", aster: "Aster", coinex: "CoinEx", bitmex: "BitMEX",
    lighter: "Lighter", paradex: "Paradex", backpack: "Backpack",
};
export function number(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
export function normalizedRate(ratePct, hours) {
    return number(ratePct) !== null && number(hours) > 0 ? ratePct * 8 / hours : null;
}
export function fundingReading(exchange, symbol, base, oiUsd, rate, hours, listedAt = null, market = {}) {
    const aliases = { XBT: "BTC", XDG: "DOGE" };
    const name = String(base).trim().toUpperCase();
    const original = aliases[name] ?? name;
    if (!(number(oiUsd) > 0) || !original || original === "UNDEFINED") return null;
    return {
        exchange, symbol, asset: canonicalAsset(original).asset, exchangeAsset: original,
        oiUsd: Number(oiUsd), ratePct: number(rate) === null ? null : Number(rate) * 100,
        intervalHours: number(hours) > 0 ? Number(hours) : null,
        fetchedAt: Date.now(), listedAt: number(listedAt),
        markPrice: number(market.markPrice) > 0 ? Number(market.markPrice) : null,
        volume24hUsd: number(market.volume24hUsd) >= 0 ? number(market.volume24hUsd) : null,
        contractSizeCoin: number(market.contractSizeCoin) > 0 ? Number(market.contractSizeCoin) : null,
    };
}
export const weighted = values => {
    const valid = values.filter(item => Number.isFinite(item.value) && item.weight > 0);
    const denominator = valid.reduce((sum, item) => sum + item.weight, 0);
    return denominator ? valid.reduce((sum, item) => sum + item.value * item.weight, 0) / denominator : null;
};
export function historicalValue(entry, timeframe, end) {
    const from = end - FUNDING_WINDOWS[timeframe];
    if (!entry) return { value: null, note: "Settled history is loading", complete: false };
    if (entry.from > from || entry.to < end || !entry.complete)
        return { value: null, note: entry.note ?? "Complete history for this window is unavailable", complete: false };
    if(entry.sums && entry.to===end && Number.isFinite(entry.sums[timeframe]))
        return { value: entry.sums[timeframe], note:null, complete:true };
    const seen = new Map();
    for (const point of entry.points ?? [])
        if (Number.isFinite(point.ratePct) && point.timestamp > from && point.timestamp <= end)
            seen.set(point.timestamp, point.ratePct);
    return { value: [...seen.values()].reduce((sum, value) => sum + value, 0), note: null, complete: true };
}
export function compactHistory(entry) {
    const sums={};
    for(const timeframe of ["1d","7d","30d","1y"]){
        const value=historicalValue(entry,timeframe,entry.to);
        if(value.complete)sums[timeframe]=value.value;
    }
    return {from:entry.from,to:entry.to,complete:entry.complete,note:entry.note,sums};
}
export function buildFundingSnapshot(states, histories, timeframe = "current", now = Date.now()) {
    const end = Math.floor(now / 3600_000) * 3600_000;
    const fresh = Object.values(states).flatMap(state => state.readings)
        .filter(item => now - item.fetchedAt <= 15 * 60_000 && item.oiUsd > 0 && isCryptoAsset(item.asset));
    const oiByExchange = Object.fromEntries(Object.keys(states).map(exchange => [exchange,
        fresh.filter(item => item.exchange === exchange).reduce((sum, item) => sum + item.oiUsd, 0)]));
    const totalOpenInterestUsd = Object.values(oiByExchange).reduce((sum, value) => sum + value, 0);
    const sources = Object.entries(states).map(([exchange, state]) => {
        const oi = oiByExchange[exchange], share = totalOpenInterestUsd ? oi / totalOpenInterestUsd * 100 : null;
        const eligible = share !== null && share >= 1;
        return { exchange, label: FUNDING_LABELS[exchange], status: !eligible && state.status === "live" ? "excluded" : state.status,
            marketCount: fresh.filter(item => item.exchange === exchange && item.ratePct !== null).length,
            openInterestUsd: oi, oiSharePct: share, eligible, updatedAt: state.updatedAt, error: state.error };
    });
    const eligible = new Set(sources.filter(source => source.eligible).map(source => source.exchange));
    const grouped = new Map();
    for (const item of fresh.filter(item => eligible.has(item.exchange))) {
        if (!grouped.has(item.asset)) grouped.set(item.asset, []);
        grouped.get(item.asset).push(item);
    }
    const rows = [...grouped].map(([asset, readings]) => {
        const venues = {};
        for (const exchange of eligible) {
            const contracts = readings.filter(item => item.exchange === exchange);
            if (!contracts.length) continue;
            const oi = contracts.reduce((sum, item) => sum + item.oiUsd, 0);
            const nativeRatePct = weighted(contracts.map(item => ({ value: item.ratePct, weight: item.oiUsd })));
            const normalized8hPct = weighted(contracts.map(item => ({ value: normalizedRate(item.ratePct, item.intervalHours), weight: item.oiUsd })));
            const intervals = new Set(contracts.map(item => item.intervalHours));
            const values = contracts.map(item => timeframe === "current"
                ? { value: normalizedRate(item.ratePct, item.intervalHours), complete: item.intervalHours !== null && item.ratePct !== null,
                    note: item.intervalHours === null ? "Funding interval unavailable" : item.ratePct === null ? "Funding quote is loading" : null }
                : historicalValue(histories.get(`${exchange}:${item.symbol}`), timeframe, end));
            const complete = values.every(item => item.complete);
            venues[exchange] = { nativeRatePct, normalized8hPct, intervalHours: intervals.size === 1 ? [...intervals][0] : null,
                openInterestUsd: oi, historyComplete: complete, historyNote: values.find(item => item.note)?.note ?? null,
                valuePct: complete ? weighted(values.map((item, index) => ({ value: item.value, weight: contracts[index].oiUsd }))) : null,
                contracts: contracts.map(item => ({ symbol: item.symbol, nativeRatePct: item.ratePct, intervalHours: item.intervalHours, openInterestUsd: item.oiUsd })) };
        }
        const contributing = Object.values(venues).filter(venue => venue.valuePct !== null);
        const displayAsset = selectDisplayAsset(readings.map(item => ({
            exchange: item.exchange, exchangeAsset: item.exchangeAsset, openInterestUsd: item.oiUsd,
        })), asset);
        return { asset, displayAsset,
            aggregatePct: weighted(contributing.map(venue => ({ value: venue.valuePct, weight: venue.openInterestUsd }))),
            aggregateOpenInterestUsd: contributing.reduce((sum, venue) => sum + venue.openInterestUsd, 0),
            sourceCount: contributing.length, venues };
    }).sort((a,b)=>b.aggregateOpenInterestUsd-a.aggregateOpenInterestUsd||a.asset.localeCompare(b.asset));
    const extremes = rows.flatMap(row => Object.entries(row.venues).filter(([,venue])=>venue.valuePct!==null)
        .map(([exchange,venue])=>({ asset:row.displayAsset, exchange, valuePct:venue.valuePct, nativeRatePct:venue.nativeRatePct, intervalHours:venue.intervalHours })));
    return { generatedAt: new Date(now).toISOString(), timeframe, isRefreshing: Object.values(states).some(state=>state.status==="refreshing"),
        universeReady: Object.values(states).every(state=>!state.running&&(state.updatedAt!==null||state.status==="error")),
        totalOpenInterestUsd, oiThresholdPct: 1, sources, rows,
        highlights: ["BTC","ETH","SOL","HYPE"].map(asset=>{const row=rows.find(row=>row.asset===asset);return{asset,valuePct:row?.aggregatePct??null,sourceCount:row?.sourceCount??0};}),
        extremes:{highest:[...extremes].sort((a,b)=>b.valuePct-a.valuePct).slice(0,5),lowest:[...extremes].sort((a,b)=>a.valuePct-b.valuePct).slice(0,5)} };
}
