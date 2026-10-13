import { canonicalAsset, selectDisplayAsset } from "./lsarMarketData.js";
import { FUNDING_LABELS } from "./fundingMath.js";
import { isCryptoAsset } from "./cryptoAssets.js";

export const OI_WINDOWS = { "5m": 300_000, "15m": 900_000, "30m": 1800_000, "1h": 3600_000, "4h": 14400_000, "24h": 86400_000 };
export const underlyingPrice = item => item.markPrice > 0 ? item.markPrice / canonicalAsset(item.exchangeAsset).priceDivisor : null;
export const coinSize = item => item.oiCoin >= 0 && item.oiCoin !== null && item.oiCoin !== undefined
    ? item.oiCoin : underlyingPrice(item) > 0 ? item.oiUsd / underlyingPrice(item) : null;
const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);
const completeSum = (items, field) => items.length && items.every(item => Number.isFinite(item[field])) ? sum(items, field) : null;

// Never turn missing history into zero or compare different contract populations.
export function candlePair(points, timeframe, now) {
    const duration = OI_WINDOWS[timeframe], currentBucket = Math.floor(now / duration);
    let current = null, previous = null;
    for (const point of points ?? []) {
        if (!Number.isFinite(point.oiCoin) || !(point.oiCoin >= 0) || !Number.isFinite(point.timestamp) || point.timestamp > now) continue;
        const bucket = Math.floor(point.timestamp / duration);
        if (bucket === currentBucket && (!current || point.timestamp > current.timestamp)) current = point;
        if (bucket === currentBucket - 1 && (!previous || point.timestamp > previous.timestamp)) previous = point;
    }
    return current && previous?.oiCoin > 0 ? { current: current.oiCoin, previous: previous.oiCoin } : null;
}
export function aggregateChange(pairs) {
    const valid = pairs.filter(Boolean), previous = valid.reduce((total, pair) => total + pair.previous, 0);
    return previous > 0 ? (valid.reduce((total, pair) => total + pair.current, 0) / previous - 1) * 100 : null;
}
export function rollingPair(points, now, duration = 86400_000, tolerance = 300_000) {
    let current = null, previous = null;
    for (const point of points ?? []) {
        if (Number.isFinite(point.timestamp) && Number.isFinite(point.oiCoin) && point.oiCoin >= 0 &&
            point.timestamp <= now && now - point.timestamp <= 900_000 &&
            (!current || point.timestamp > current.timestamp)) current = point;
    }
    if (!current) return null;
    const target = current.timestamp - duration;
    for (const point of points ?? []) {
        if (Number.isFinite(point.timestamp) && Number.isFinite(point.oiCoin) && point.oiCoin > 0 &&
            point.timestamp <= target && target - point.timestamp <= tolerance &&
            (!previous || point.timestamp > previous.timestamp)) previous = point;
    }
    return previous ? { current: current.oiCoin, previous: previous.oiCoin } : null;
}
export function buildOiSnapshot(states, histories, nativeHistories, timeframe, now = Date.now(), selection = [], options = {}) {
    const rolling = options.comparison === "rolling24h";
    const selected = selection.length ? new Set(selection) : null;
    const all = Object.values(states).flatMap(state => state.readings).filter(item =>
        item.oiUsd > 0 && (item.exchange === "cme" || now - item.fetchedAt <= 900_000));
    const sources = Object.entries(states).map(([exchange, state]) => {
        const items = all.filter(item => item.exchange === exchange);
        return { exchange, label: exchange === "cme" ? "CME" : FUNDING_LABELS[exchange] ?? exchange,
            status: items.length ? state.running ? "refreshing" : state.status === "error" ? "delayed" : "live" : state.status,
            marketCount: items.length, openInterestUsd: sum(items, "oiUsd"), eligible: items.length > 0,
            oiSharePct: null, updatedAt: state.updatedAt, error: state.error };
    });
    const grouped = new Map();
    for (const item of all.filter(item => !selected || selected.has(item.exchange))) {
        if (!grouped.has(item.asset)) grouped.set(item.asset, []);
        grouped.get(item.asset).push({ ...item, oiCoin: coinSize(item) });
    }
    const eligibleCryptoCount = [...grouped.keys()].filter(isCryptoAsset).length;
    const rows = [...grouped].filter(([asset]) => !rolling || isCryptoAsset(asset)).map(([asset, items]) => {
        const venues = {}, paired = [];
        for (const exchange of new Set(items.map(item => item.exchange))) {
            const contracts = items.filter(item => item.exchange === exchange), pairs = [];
            for (const item of contracts) {
                if (exchange === "cme") continue; // Daily reports are not intraday candle observations.
                const key = `${exchange}:${item.symbol}`;
                const native = nativeHistories.get(key) ?? nativeHistories.get(`${key}:${timeframe}`);
                const points = [...(native ?? []), ...(histories.get(key) ?? [])];
                const pair = rolling ? rollingPair(points, now) : candlePair(points, timeframe, now);
                if (pair) pairs.push(pair);
            }
            if (pairs.length) paired.push(...pairs.map(pair => ({ ...pair, exchange })));
            venues[exchange] = { oiCoin: completeSum(contracts, "oiCoin"), oiUsd: sum(contracts, "oiUsd"),
                changePct: aggregateChange(pairs), volume24hUsd: completeSum(contracts, "volume24hUsd"),
                reportedAt: exchange === "cme" ? [...new Set(contracts.map(item => item.reportDate))].sort().join(", ") : null,
                contractCount: contracts.length };
        }
        // Ratio numerator and denominator must cover exactly the same venues.
        // A CME trading-day volume is not interchangeable with rolling 24-hour volume.
        const volumeVenues = Object.entries(venues).filter(([exchange, venue]) => exchange !== "cme" && venue.volume24hUsd !== null);
        const volume = volumeVenues.length ? volumeVenues.reduce((total, [, venue]) => total + venue.volume24hUsd, 0) : null;
        const ratioOi = volumeVenues.reduce((total, [, venue]) => total + venue.oiUsd, 0);
        return { asset, displayAsset: selectDisplayAsset(items.map(item => ({ exchange: item.exchange,
            exchangeAsset: item.exchangeAsset, openInterestUsd: item.oiUsd })), asset),
            aggregateOiCoin: completeSum(items, "oiCoin"), aggregateOiUsd: sum(items, "oiUsd"),
            changePct: aggregateChange(paired), matchedSourceCount: new Set(paired.map(pair => pair.exchange)).size,
            sourceCount: Object.keys(venues).length, volume24hUsd: volume, volumeSourceCount: volumeVenues.length,
            oiVolumeRatio: volume > 0 ? ratioOi / volume : null, venues };
    }).sort((a, b) => b.aggregateOiUsd - a.aggregateOiUsd || a.asset.localeCompare(b.asset));
    return { generatedAt: new Date(now).toISOString(), timeframe, comparison: rolling ? "rolling24h" : "candle", sources, rows,
        rankingCoverage: rolling ? { eligibleCoins: eligibleCryptoCount,
            coinsWithHistory: rows.filter(row => row.changePct !== null).length,
            excludedNonCryptoOrUnverifiedCoins: grouped.size - eligibleCryptoCount } : undefined,
        totalOpenInterestUsd: rows.reduce((total, row) => total + row.aggregateOiUsd, 0),
        historyReadyCount: rows.filter(row => row.changePct !== null).length,
        cmeReportDates: [...new Set(all.filter(item => item.exchange === "cme").map(item => item.reportDate))].sort(),
        universeReady: Object.values(states).every(state => !state.running && state.status !== "connecting"),
        isRefreshing: Object.values(states).some(state => state.running),
        extremes: { gainers: rows.filter(row => row.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, 5),
            losers: rows.filter(row => row.changePct !== null && row.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, 5) } };
}
