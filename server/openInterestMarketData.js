import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { getPerpetualInventory } from "./fundingMarketData.js";
import { requestJson, requestGates } from "./exchangeRequests.js";
import { OI_WINDOWS, buildOiSnapshot, coinSize, candlePair, rollingPair } from "./openInterestMath.js";
import { getCmeState } from "./cmeOpenInterest.js";
import { fetchOiHistoryWindow, hasOiBackfill, mergeOiPoints } from "./openInterestHistory.js";
import { volumeSupplement } from "./openInterestVolume.js";
import { createOiHistoryQueue } from "./oiHistoryQueue.js";
import { isCryptoAsset } from "./cryptoAssets.js";

const directory = process.env.OI_HISTORY_DIR ? resolve(process.env.OI_HISTORY_DIR)
    : fileURLToPath(new URL("../.cache/open-interest/", import.meta.url));
const histories = new Map(), loaded = new Set(), dirty = new Set(), requestedFrames = new Set(["1h"]);
const nativeHistories = new Map();
let timer = null, saveTimer = null;
const retention = 30 * 3600_000;
function mergePoints(key, incoming, now) {
    histories.set(key, mergeOiPoints(histories.get(key) ?? [], incoming, now));
}
function load(exchange) {
    if (loaded.has(exchange)) return;
    loaded.add(exchange);
    try {
        const saved = JSON.parse(readFileSync(join(directory, `${exchange}.json`), "utf8"));
        for (const [key, points] of Object.entries(saved))
            if (Array.isArray(points) && key.startsWith(`${exchange}:`)) mergePoints(key, points, Date.now());
    } catch (error) { if (error.code !== "ENOENT") console.warn("OI history cache could not be read:", error.message); }
}
function persist(exchange) {
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `${exchange}.json`);
    const data = Object.fromEntries([...histories].filter(([key]) => key.startsWith(`${exchange}:`)));
    writeFileSync(`${file}.tmp`, JSON.stringify(data)); renameSync(`${file}.tmp`, file);
}
function markDirty(exchange) {
    dirty.add(exchange);
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        for (const exchange of dirty) {
            try { persist(exchange); } catch (error) { console.warn("OI history cache could not be saved:", error.message); }
        }
        dirty.clear();
    }, 2000);
    saveTimer.unref();
}
function inventoryAndSamples(now) {
    const raw = getPerpetualInventory(), states = {};
    for (const [exchange, state] of Object.entries(raw)) {
        load(exchange);
        const supplemental = volumeSupplement(exchange, now);
        const readings = state.readings.map(item => {
            const quote = supplemental?.get(item.symbol);
            return quote ? { ...item, volume24hUsd: quote.volume24hUsd ?? item.volume24hUsd,
                markPrice: item.markPrice ?? quote.markPrice ?? null } : item;
        });
        states[exchange] = { ...state, readings };
        let changed = false;
        for (const item of readings) {
            const quantity = coinSize(item);
            if (!Number.isFinite(quantity) || !Number.isFinite(item.fetchedAt) ||
                item.fetchedAt > now || now - item.fetchedAt > 900_000) continue;
            const key = `${exchange}:${item.symbol}`, points = histories.get(key) ?? [];
            // Only record an actually new provider observation, never a browser refresh.
            if (points.at(-1)?.timestamp === item.fetchedAt || points.some(point => point.timestamp === item.fetchedAt)) continue;
            mergePoints(key, [{ timestamp: item.fetchedAt, oiCoin: quantity }], now);
            changed = true;
        }
        for (const [key, points] of histories)
            if (key.startsWith(`${exchange}:`) && points.at(-1)?.timestamp < now - retention) histories.delete(key);
        if (changed) markDirty(exchange);
    }
    states.cme = getCmeState(states, now);
    return states;
}
const queue = createOiHistoryQueue({
    supported: hasOiBackfill,
    isCoolingDown: exchange => requestGates[exchange]?.isCoolingDown,
    needed(item) {
        const now = Date.now(), points = histories.get(`${item.exchange}:${item.symbol}`) ?? [];
        return !rollingPair(points, now) || [...requestedFrames].some(frame => !candlePair(points, frame, now));
    },
    fetchHistory: (item, now) => fetchOiHistoryWindow(requestJson, item, now),
    onPoints(item, points) {
        mergePoints(`${item.exchange}:${item.symbol}`, points, Date.now());
        markDirty(item.exchange);
    },
});
function schedule(states, now) {
    const readings = Object.values(states).flatMap(state => state.readings)
        .filter(item => item.exchange !== "cme" && now - item.fetchedAt <= 900_000)
        .sort((a, b) => Number(isCryptoAsset(b.asset)) - Number(isCryptoAsset(a.asset)) || b.oiUsd - a.oiUsd);
    queue.schedule(readings);
}
function backgroundTick() {
    try { const now = Date.now(); schedule(inventoryAndSamples(now), now); }
    catch (error) { console.warn("OI background collection failed:", error.message); }
}
export function getOpenInterestSnapshot(timeframe = "1h", selection = [], comparison = "candle") {
    if (!Object.hasOwn(OI_WINDOWS, timeframe)) throw new Error("Invalid OI timeframe");
    if (comparison === "candle") requestedFrames.add(timeframe);
    const now = Date.now(), states = inventoryAndSamples(now);
    if (!timer) {
        // Sampling continues while the service runs, even when users close the page.
        timer = setInterval(backgroundTick, 30_000);
        timer.unref();
        setTimeout(backgroundTick, 2000).unref();
    }
    schedule(states, now);
    const snapshot = buildOiSnapshot(states, histories, nativeHistories, timeframe, now, selection, { comparison });
    return { ...snapshot, isRefreshing: snapshot.isRefreshing || queue.pendingCount > 0,
        notes: [
            "OI contract size is expressed in equivalent underlying-coin units, not a sum of incompatible exchange contract counts. OI is summed, not OI-weighted.",
            "Shorter table TF changes compare the latest available observations in the current and previous candle, using the same contracts on both sides. The table's 24h option shares the rolling 24-hour snapshot used by top gainers/losers. Missing baselines are unavailable, not zero.",
            "Top gainers/losers use rolling 24-hour coin-equivalent OI changes, independently of table TF. A baseline must be at or up to five minutes before each venue's latest observation minus 24 hours. Only verified crypto identities qualify; stocks, ETFs, commodities and unverified identities are excluded from rankings. Coverage counts show coins with at least one matched venue, not complete coverage of all venues.",
            "Binance, Bybit and Gate linear contracts backfill shared five-minute history in a fair background queue. Other contracts build history from genuine collected snapshots; longer TFs require time to accumulate. Shared exchange limits/cooldowns apply to all requests.",
            "OI / 24H Volume uses the same venues with verified rolling 24-hour volume. CME trading-day volume is excluded. Base-denominated volumes are valued at the latest quote.",
            snapshot.cmeReportDates.length
                ? `CME daily reports included in total OI: ${snapshot.cmeReportDates.join(", ")}. Standard and Micro contracts are converted to underlying-coin units and marked using current crypto-exchange prices. CME is excluded from intraday changes.`
                : `CME is not contributing to totals: ${states.cme.error ?? "An authorized daily report/feed is required."}`,
        ] };
}
