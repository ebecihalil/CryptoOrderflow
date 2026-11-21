// Long open-interest history (30 days) per coin and exchange, at 5-minute steps.
// The OI screener samples every contract about every 30 s but keeps only 30 hours;
// keeping that for every contract for months would not fit. This keeps, for the
// coins people view (and the always-recorded top coins), the TOTAL open interest
// (coins) of each exchange every 5 minutes, saved to disk.
//
// A 5-minute point is written only when every contract of that exchange has a
// sample in the 15 minutes before the step (strict: a missing contract never
// makes a fake drop).
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { RECORD_DAYS } from "./retention.js";

export const OI_LONG_STEP_MS = 300_000;
export const OI_LONG_RETENTION_MS = RECORD_DAYS * 86400_000;
const FRESH_MS = 15 * 60_000, TRACK_MS = 2 * 3600_000;

/** Per exchange, the total OI at each 5-minute step that every contract covers. */
export function exchangeSteps(contracts, fromMs, toMs) {
  const byExchange = new Map();
  for (const contract of contracts) {
    const list = byExchange.get(contract.exchange) ?? [];
    list.push([...(contract.points ?? [])].filter(p => Number.isFinite(p.timestamp) && Number.isFinite(p.oiCoin)).sort((a, b) => a.timestamp - b.timestamp));
    byExchange.set(contract.exchange, list);
  }
  const out = {};
  for (const [exchange, lists] of byExchange) {
    const points = [];
    const index = lists.map(() => -1);
    for (let step = Math.ceil(fromMs / OI_LONG_STEP_MS) * OI_LONG_STEP_MS; step <= toMs; step += OI_LONG_STEP_MS) {
      let total = 0, ok = true;
      lists.forEach((list, k) => {
        while (index[k] + 1 < list.length && list[index[k] + 1].timestamp <= step) index[k]++;
        const point = list[index[k]];
        if (!point || step - point.timestamp > FRESH_MS) ok = false; else total += point.oiCoin;
      });
      if (ok) points.push({ timestamp: step, oiCoin: total });
    }
    if (points.length) out[exchange] = points;
  }
  return out;
}

export function createOiLongHistory({ directory, now = Date.now, always = [] } = {}) {
  const stores = new Map(); // asset -> {exchange: [{timestamp, oiCoin}]}
  const requested = new Map(); // asset -> last request time
  const dirty = new Set();
  const file = asset => join(directory, `${asset}.json`);
  function load(asset) {
    if (stores.has(asset)) return stores.get(asset);
    let store = {};
    if (directory) {
      try {
        const saved = JSON.parse(readFileSync(file(asset), "utf8"));
        for (const [exchange, points] of Object.entries(saved ?? {})) {
          if (!Array.isArray(points)) continue;
          store[exchange] = points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] >= 0)
            .map(([timestamp, oiCoin]) => ({ timestamp, oiCoin }));
        }
      } catch { store = {}; }
    }
    stores.set(asset, store);
    return store;
  }
  function save() {
    if (!directory) { dirty.clear(); return; }
    try { mkdirSync(directory, { recursive: true }); } catch { return; }
    for (const asset of dirty) {
      const data = Object.fromEntries(Object.entries(stores.get(asset) ?? {}).map(([exchange, points]) => [exchange, points.map(p => [p.timestamp, p.oiCoin])]));
      try { writeFileSync(`${file(asset)}.tmp`, JSON.stringify(data)); renameSync(`${file(asset)}.tmp`, file(asset)); } catch { /* retried next time */ }
    }
    dirty.clear();
  }
  /** Add the 5-minute totals that the recent (30 h) samples cover and the store does not have yet. */
  function record(asset, contracts) {
    const store = load(asset), time = now();
    const steps = exchangeSteps(contracts, time - 30 * 3600_000, time);
    let changed = false;
    for (const [exchange, points] of Object.entries(steps)) {
      const list = store[exchange] ??= [];
      const have = new Set(list.map(p => p.timestamp));
      for (const point of points) if (!have.has(point.timestamp)) { list.push(point); changed = true; }
      if (changed) list.sort((a, b) => a.timestamp - b.timestamp);
      const cutoff = time - OI_LONG_RETENTION_MS;
      if (list.length && list[0].timestamp < cutoff) { store[exchange] = list.filter(p => p.timestamp >= cutoff); changed = true; }
    }
    if (changed) dirty.add(asset);
  }
  return {
    track(asset) { requested.set(asset, now()); },
    /** Coins to record now: viewed in the last 2 hours, plus the always-recorded ones. */
    tracked() {
      for (const [asset, at] of requested) if (now() - at > TRACK_MS) { requested.delete(asset); if (!always.includes(asset)) stores.delete(asset); }
      return [...new Set([...always, ...requested.keys()])];
    },
    record, save,
    series(asset) { return load(asset); },
  };
}
