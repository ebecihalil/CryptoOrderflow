import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getPerpetualInventory } from "./fundingMarketData.js";
import { requestJson, requestGates } from "./exchangeRequests.js";
import { OI_WINDOWS, buildOiSnapshot, coinSize } from "./openInterestMath.js";
import { getCmeState } from "./cmeOpenInterest.js";
import { fetchOiHistory, hasOiBackfill } from "./openInterestHistory.js";
import { volumeSupplement } from "./openInterestVolume.js";

const directory = fileURLToPath(new URL("../.cache/open-interest/", import.meta.url));
const histories = new Map(), nativeHistories = new Map(), loaded = new Set(), pending = new Set(), attempts = new Map(), active = new Map();
let timer = null;
const retention = 30 * 3600_000;
function load(exchange) {
    if (loaded.has(exchange)) return;
    loaded.add(exchange);
    try {
        const saved = JSON.parse(readFileSync(join(directory, `${exchange}.json`), "utf8"));
        for (const [key, points] of Object.entries(saved))
            if (Array.isArray(points)) histories.set(key, points.filter(point => Number.isFinite(point.timestamp) &&
                Date.now() - point.timestamp <= retention && Number.isFinite(point.oiCoin) && point.oiCoin >= 0).slice(-384));
    } catch (error) { if (error.code !== "ENOENT") console.warn("OI history cache could not be read:", error.message); }
}
function persist(exchange) {
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `${exchange}.json`);
    const data = Object.fromEntries([...histories].filter(([key]) => key.startsWith(`${exchange}:`)));
    writeFileSync(`${file}.tmp`, JSON.stringify(data)); renameSync(`${file}.tmp`, file);
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
            if (quantity === null || now - item.fetchedAt > 900_000) continue;
            const key = `${exchange}:${item.symbol}`, points = histories.get(key) ?? [];
            // Only record an actually new provider observation, never a browser refresh.
            if (points.at(-1)?.timestamp === item.fetchedAt) continue;
            points.push({ timestamp: item.fetchedAt, oiCoin: quantity });
            histories.set(key, points.filter(point => now - point.timestamp <= retention).slice(-384));
            changed = true;
        }
        for (const [key, points] of histories)
            if (key.startsWith(`${exchange}:`) && points.at(-1)?.timestamp < now - retention) histories.delete(key);
        if (changed) { try { persist(exchange); } catch (error) { console.warn("OI history cache could not be saved:", error.message); } }
    }
    states.cme = getCmeState(states, now);
    return states;
}
function queueHistory(item, timeframe, now) {
    if (!hasOiBackfill(item) || requestGates[item.exchange].isCoolingDown) return;
    const key = `${item.exchange}:${item.symbol}:${timeframe}`, bucket = Math.floor(now / OI_WINDOWS[timeframe]);
    const previous = attempts.get(key);
    if (pending.has(key) || (active.get(item.exchange) ?? 0) >= 2 ||
        (previous?.bucket === bucket && (previous.ok || now - previous.time < 300_000))) return;
    attempts.set(key, { bucket, time: now, ok: false });
    pending.add(key); active.set(item.exchange, (active.get(item.exchange) ?? 0) + 1);
    fetchOiHistory(requestJson, item, timeframe, now).then(points => {
        nativeHistories.set(key, points); attempts.set(key, { bucket, time: now, ok: points.length > 0 });
    }).catch(() => { /* Unavailable history is excluded from changes, not given a synthetic zero. */ })
        .finally(() => { pending.delete(key); active.set(item.exchange, active.get(item.exchange) - 1); });
}
export function getOpenInterestSnapshot(timeframe = "1h", selection = []) {
    if (!Object.hasOwn(OI_WINDOWS, timeframe)) throw new Error("Invalid OI timeframe");
    const now = Date.now(), states = inventoryAndSamples(now);
    if (!timer) {
        // Sampling continues while the service runs, even when users close the page.
        timer = setInterval(() => inventoryAndSamples(Date.now()), 30_000);
        timer.unref();
    }
    const readings = Object.values(states).flatMap(state => state.readings)
        .filter(item => item.exchange !== "cme" && now - item.fetchedAt <= 900_000 &&
            (!selection.length || selection.includes(item.exchange)))
        .sort((a, b) => b.oiUsd - a.oiUsd);
    for (const item of readings) queueHistory(item, timeframe, now);
    const snapshot = buildOiSnapshot(states, histories, nativeHistories, timeframe, now, selection);
    return { ...snapshot, isRefreshing: snapshot.isRefreshing || pending.size > 0,
        notes: [
            "OI contract size is expressed in equivalent underlying-coin units, not a sum of incompatible exchange contract counts. OI is summed, not OI-weighted.",
            "TF change compares the latest available observations in the current and previous candle, using the same contracts on both sides. Contracts without a prior observation are excluded from change rankings, not shown as zero.",
            "Binance, Bybit and Gate linear contracts backfill verified five-minute OI history. Other contracts build history from collected snapshots; shorter TF changes appear first, with longer TFs available as history accumulates.",
            "OI / 24H Volume uses the same venues with verified rolling 24-hour volume. CME trading-day volume is excluded. Base-denominated volumes are valued at the latest quote.",
            snapshot.cmeReportDates.length
                ? `CME daily reports included in total OI: ${snapshot.cmeReportDates.join(", ")}. Standard and Micro contracts are converted to underlying-coin units and marked using current crypto-exchange prices. CME is excluded from intraday changes.`
                : `CME is not contributing to totals: ${states.cme.error ?? "An authorized daily report/feed is required."}`,
        ] };
}
