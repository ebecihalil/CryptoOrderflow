import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getPerpetualInventory } from "./fundingMarketData.js";
import { fetchFundingHistory } from "./fundingHistory.js";
import { requestGates, requestJson } from "./exchangeRequests.js";
import { aggregateFundingRates, selectFundingIndicatorSources, validateFundingIndicatorQuery,
  settledFundingChart, recordedFundingChart, INDICATOR_WINDOWS } from "./fundingIndicatorMath.js";
import { normalizedSettledRates } from "./fundingIndicatorMath.js";

const root = fileURLToPath(new URL("../.cache/", import.meta.url));
const unsupportedHistory = new Set(["lighter", "paradex", "coinex", "bitmex", "backpack", "toobit"]);
const trim = (map, size) => { while (map.size > size) map.delete(map.keys().next().value); };

export function createFundingIndicatorService({
  inventory = getPerpetualInventory, fetchHistory = fetchFundingHistory, request = requestJson,
  gates = requestGates, now = Date.now, storageDir = root, timers = true,
} = {}) {
  const histories = new Map(), pending = new Map(), observations = new Map(), active = new Map();
  const loaded = new Set(), persisted = new Map();
  let timer = null;
  const historyKey = item => `${item.exchange}:${item.symbol}`;

  function loadObservations(asset) {
    if (loaded.has(asset)) return;
    loaded.add(asset); trimLoaded();
    if (!storageDir) return;
    try {
      const saved = JSON.parse(readFileSync(join(storageDir, "funding-indicator", `${asset}.json`), "utf8"));
      if (!Array.isArray(saved)) throw new Error("Invalid recorded quotes.");
      const valid = saved.filter(point => Number.isFinite(point.time) && point.time * 1000 <= now() &&
        point.time * 1000 >= now() - 7 * 86400_000 && ["meanPct", "medianPct", "weightedPct"].every(key =>
          typeof point[key] === "number" && Number.isFinite(point[key])) && Number.isInteger(point.sourceCount) && point.sourceCount > 0);
      observations.set(asset, valid.sort((a, b) => a.time - b.time).slice(-10080));
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("Recorded funding cache is unavailable; a new live series will start.");
    }
  }
  function trimLoaded() {
    while (loaded.size > 20) { const old = loaded.values().next().value; loaded.delete(old); observations.delete(old); persisted.delete(old); }
  }
  function record(asset, current) {
    if (!current.sourceCount) return;
    loadObservations(asset);
    const points = observations.get(asset) ?? [];
    const previous = points.at(-1);
    const point = { time: current.time, meanPct: current.meanPct, medianPct: current.medianPct,
      weightedPct: current.weightedPct, weightedFallback: current.weightedFallback, sourceCount: current.sourceCount };
    if (previous && Math.floor(previous.time / 60) === Math.floor(point.time / 60)) points[points.length - 1] = point;
    else points.push(point);
    const retained = points.filter(item => item.time >= current.time - 7 * 86400).slice(-10080);
    observations.set(asset, retained); trim(observations, 20);
    if (storageDir && now() - (persisted.get(asset) ?? 0) >= 60_000) {
      try {
        const directory = join(storageDir, "funding-indicator"); mkdirSync(directory, { recursive: true });
        const file = join(directory, `${asset}.json`);
        writeFileSync(`${file}.tmp`, JSON.stringify(retained)); renameSync(`${file}.tmp`, file);
        persisted.set(asset, now());
      } catch {
        console.warn("Live funding tracking continues in memory; local cache could not be saved.");
      }
    }
  }
  function track(asset) {
    active.set(asset, now()); trim(active, 10);
    if (!timers || timer) return;
    timer = setInterval(() => {
      for (const [tracked, visitedAt] of active) if (now() - visitedAt > 45 * 60_000) active.delete(tracked);
      if (!active.size) { clearInterval(timer); timer = null; return; }
      const states = inventory();
      for (const tracked of active.keys()) {
        const sources = selectFundingIndicatorSources(states, tracked, now());
        record(tracked, { ...aggregateFundingRates(sources.filter(source => source.status === "ok")), time: Math.floor(now() / 1000) });
      }
    }, 30_000);
    timer.unref?.();
  }

  function savedPayments(key) {
    if (!storageDir) return null;
    try {
      const entry = JSON.parse(readFileSync(join(storageDir, "funding-history", `${encodeURIComponent(key)}.json`), "utf8"));
      return Array.isArray(entry.points) && Number.isFinite(entry.from) && Number.isFinite(entry.to) ? entry : null;
    } catch { return null; }
  }
  function queuePayments(item, from, to) {
    const key = historyKey(item);
    if (unsupportedHistory.has(item.exchange)) return;
    let cached = histories.get(key);
    if (!cached) {
      const saved = savedPayments(key);
      if (saved) { cached = { entry: saved, nextAttempt: 0 }; histories.set(key, cached); }
    }
    const needsEarlier = cached?.entry?.from > from && !cached.failed;
    if (pending.has(key) || pending.size >= 8 || (cached?.nextAttempt > now() && !needsEarlier) ||
      (cached?.entry?.complete && cached.entry.from <= from && cached.entry.to >= to)) return;
    if (gates[item.exchange]?.isCoolingDown) return;
    const old = cached?.entry;
    const fetchFrom = old?.complete && old.from <= from ? old.to : from;
    const task = fetchHistory(request, item, fetchFrom, to).then(result => {
      let entry = result;
      if (old?.complete && old.from <= from && result.complete) {
        const merged = new Map([...old.points, ...result.points].map(point => [point.timestamp, point]));
        entry = { ...result, from: Math.max(old.from, to - 32 * 86400_000),
          points: [...merged.values()].filter(point => point.timestamp >= to - 32 * 86400_000) };
      }
      // Funding page's compact sums are never mistaken for actual event history.
      histories.set(key, { entry, nextAttempt: now() + 300_000 });
    }).catch(() => {
      histories.set(key, { entry: old ?? null, nextAttempt: Math.max(now() + 300_000, gates[item.exchange]?.blockedUntil ?? 0),
        failed: true });
    }).finally(() => { pending.delete(key); trim(histories, 200); });
    pending.set(key, task);
  }

  function get(query = {}) {
    const { asset, timeframe, window } = validateFundingIndicatorQuery(query);
    track(asset); loadObservations(asset);
    const states = inventory(), time = Math.floor(now() / 1000);
    const sources = selectFundingIndicatorSources(states, asset, now());
    const current = { ...aggregateFundingRates(sources.filter(source => source.status === "ok")), time };
    record(asset, current);
    // Extra preceding payments allow historical period inference without using
    // today's interval or inventing a rate for the first returned payment.
    const from = (time - INDICATOR_WINDOWS[window]) * 1000;
    const end = Math.floor(now() / 300_000) * 300_000;
    for (const source of sources) if (source.item) queuePayments(source.item, from - 48 * 3600_000, end);
    const chartEntries = [];
    const output = sources.map(({ item, ...source }) => {
      const key = item ? historyKey(item) : null, saved = key ? histories.get(key) : null, entry = saved?.entry;
      const hasPayments = (entry?.points?.length ?? 0) > 1;
      let historyStatus = hasPayments ? (entry.complete && entry.from <= from && entry.to >= end && !saved.failed ? "ready" : "partial")
        : key && pending.has(key) ? "loading" : "unavailable";
      if (hasPayments) {
        try {
          if (normalizedSettledRates(entry).length) chartEntries.push(entry);
          else historyStatus = "unavailable";
        }
        catch { historyStatus = "unavailable"; }
      }
      return { ...source, historyStatus,
        historyNote: unsupportedHistory.has(source.exchange) ? "Settled history is not verified for this venue."
          : historyStatus === "partial" ? "Only the available settled-payment history is plotted."
            : historyStatus === "unavailable" ? "Settled payments are not available yet." : undefined };
    });
    const points = settledFundingChart(chartEntries, from / 1000, time, timeframe);
    const observed = observations.get(asset) ?? [];
    return { asset, generatedAt: new Date(now()).toISOString(), isRefreshing: pending.size > 0 || Object.values(states).some(state => state.running),
      basis: "normalized8h", current, sources: output,
      history: { kind: "settled", points, sourcesReady: output.filter(source => source.historyStatus === "ready" || source.historyStatus === "partial").length,
        isLoading: sources.some(source => source.item && pending.has(historyKey(source.item))) },
      observations: { kind: "recordedLive", points: recordedFundingChart(observed, from / 1000, time, timeframe),
        startedAt: observed.length ? new Date(observed[0].time * 1000).toISOString() : null },
      historyWindow: window, timeframe };
  }
  return { get, stop: () => { if (timer) clearInterval(timer); timer = null; } };
}
export const fundingIndicatorService = createFundingIndicatorService();
