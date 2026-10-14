import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { CVD_EXCHANGES, createCvdMarketResolver } from "./cvdMarkets.js";
import { createCvdStreamFactory } from "./cvdStreams.js";
import { addCvdTrade, newCvdMinute, buildCvdCandles, cvdAnchorStart, validateCvdQuery } from "./cvdMath.js";

// Two weeks preserve the previous full calendar week plus the current week.
const RETENTION = 14 * 86400, MAX_GROUPS = 4, MAX_QUEUE = 50_000, IDLE_MS = 30 * 60_000;
const timeOrder = (a, b) => {
  if (a.time !== b.time) return a.time - b.time;
  if (a.exchange !== b.exchange) return a.exchange.localeCompare(b.exchange);
  if (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)) return BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0;
  return a.id.localeCompare(b.id);
};
const initialSources = () => CVD_EXCHANGES.map(exchange => ({
  exchange, status: "loading", symbol: null, tradeCount: 0, lastTradeAt: null,
}));

export function createCvdIndicatorService({
  resolver = createCvdMarketResolver(), streams = createCvdStreamFactory(), now = Date.now,
  storageDir = fileURLToPath(new URL("../.cache/cvd-recordings/", import.meta.url)), timers = true,
} = {}) {
  const groups = new Map();
  const file = group => path.join(storageDir, `${group.market}-${group.asset}.json.gz`);
  function markGap(group, at = now()) {
    group.gaps.add(Math.floor(at / 60000) * 60);
  }
  function ingest(group, trade) {
    if (!group.active || !(trade.time >= group.subscribedSince && trade.time <= now() + 5000)) return;
    const id = `${trade.exchange}:${trade.symbol}:${trade.id}`;
    if (group.ids.has(id)) return;
    group.ids.set(id, trade.time);
    const source = group.sources.find(s => s.exchange === trade.exchange);
    source.status = "live"; source.tradeCount++; source.lastTradeAt = new Date(trade.time).toISOString();
    if (group.queue.length >= MAX_QUEUE) {
      group.dropped = true; markGap(group); return;
    }
    group.queue.push(trade);
    group.dirty = true;
  }
  function flush(group, closing = false) {
    const cutoff = closing ? now() + 5000 : now() - 2500;
    const ordered = group.queue.sort(timeOrder);
    const pending = [];
    for (const trade of ordered) {
      if (trade.time > cutoff) { pending.push(trade); continue; }
      if (trade.time < group.lastProcessedTime) {
        group.late = true; markGap(group, trade.time);
        // Without retained tick order we cannot reconstruct historical extrema.
        // Exclude late executions explicitly, never call incomplete data complete.
        continue;
      }
      const time = Math.floor(trade.time / 60000) * 60;
      if (!group.minutes.has(time)) group.minutes.set(time, newCvdMinute(time, group.gaps.has(time)));
      const row = group.minutes.get(time);
      if (group.gaps.has(time)) row.gap = true;
      addCvdTrade(row, trade);
      group.lastProcessedTime = trade.time;
    }
    group.queue = pending;
    const earliest = Math.floor(now() / 1000) - RETENTION;
    for (const t of group.minutes.keys()) if (t < earliest) group.minutes.delete(t);
    for (const t of group.gaps) if (t < earliest) group.gaps.delete(t);
    for (const [id, t] of group.ids) if (t < now() - 180_000) group.ids.delete(id);
  }
  async function save(group) {
    if (group.saving) return group.saveTask;
    if (!storageDir || !group.loaded || !group.dirty) return;
    group.saving = true;
    group.dirty = false;
    group.saveTask = (async () => {
    try {
      const payload = { version: 1, asset: group.asset, market: group.market, startedAt: group.startedAt,
        lastProcessedTime: group.lastProcessedTime, gaps: [...group.gaps], minutes: [...group.minutes.values()] };
      await mkdir(storageDir, { recursive: true });
      const temporary = `${file(group)}.tmp`;
      await writeFile(temporary, gzipSync(JSON.stringify(payload)));
      await rename(temporary, file(group));
      group.storageFailed = false;
    } catch { group.storageFailed = true; group.dirty = true; }
    finally { group.saving = false; }
    })();
    return group.saveTask;
  }
  async function load(group) {
    if (!storageDir) return;
    try {
      const body = JSON.parse(gunzipSync(await readFile(file(group)), { maxOutputLength: 60_000_000 }));
      if (body.version !== 1 || body.asset !== group.asset || body.market !== group.market ||
        !Array.isArray(body.minutes) || body.minutes.length > 150_000 || !Number.isFinite(body.startedAt)) throw new Error("Invalid recording.");
      for (const r of body.minutes) {
        if (!Number.isSafeInteger(r.time) || r.time > now() / 1000 || r.time < now() / 1000 - RETENTION ||
          !["delta", "high", "low", "buyValue", "sellValue", "trades"].every(k => Number.isFinite(r[k])) ||
          r.trades < 1 || r.buyValue < 0 || r.sellValue < 0 || !Array.isArray(r.sources) ||
          r.sources.some(s => !CVD_EXCHANGES.includes(s))) continue;
        group.minutes.set(r.time, r);
      }
      group.startedAt = body.startedAt;
      group.lastProcessedTime = Number.isFinite(body.lastProcessedTime) ? body.lastProcessedTime : 0;
      if (Array.isArray(body.gaps)) body.gaps.filter(Number.isSafeInteger).forEach(t => group.gaps.add(t));
      if (group.minutes.size) markGap(group); // downtime is unknown, not zero volume
    } catch (error) {
      if (error.code !== "ENOENT") group.storageFailed = true;
    }
  }
  async function startSource(group, source) {
    try {
      const instrument = await resolver.resolve(source.exchange, group.market, group.asset);
      if (!group.active) return;
      if (!instrument) { source.status = "not_listed"; return; }
      source.symbol = instrument.symbol;
      const handle = await streams.start(instrument, trade => ingest(group, trade), state => {
        if (!group.active) return;
        if (source.status !== state && group.minutes.size) markGap(group);
        source.status = state;
      });
      if (!group.active) handle.stop(); else group.handles.push(handle);
    } catch (error) {
      source.status = error.loading ? "loading" : "unavailable";
      if (group.active) {
        const timer = setTimeout(() => { group.retries.delete(timer); void startSource(group, source); }, error.loading ? 3000 : 300_000);
        timer.unref?.(); group.retries.add(timer);
      }
    }
  }
  async function initialize(group) {
    await load(group);
    group.loaded = true;
    if (group.active) await Promise.all(group.sources.map(source => startSource(group, source)));
  }
  function stopGroup(group) {
    group.active = false;
    group.retries.forEach(clearTimeout); group.retries.clear();
    group.handles.forEach(handle => handle.stop()); group.handles = [];
    flush(group, true); markGap(group); group.dirty = true; void save(group);
    group.sources.forEach(source => { source.status = "idle"; });
  }
  function get(query) {
    const parsed = validateCvdQuery(query);
    parsed.asset = canonicalAsset(parsed.asset).asset;
    if (!isCryptoAsset(parsed.asset)) throw Object.assign(new Error("CVD is available for crypto assets only."), { status: 400 });
    const { asset, market, timeframe, anchor } = parsed;
    const key = `${market}:${asset}`;
    let group = groups.get(key);
    if (!group) {
      for (const [oldKey, old] of groups) {
        if (now() - old.lastUsed > IDLE_MS && old.active) stopGroup(old);
        // Pause a genuinely unviewed LRU cohort under pressure, not a collector
        // another tab is still polling. Its recorded history remains on disk.
        if (groups.size >= MAX_GROUPS && old.active && now() - old.lastUsed > 15_000) stopGroup(old);
        if (!old.active && !old.saving) groups.delete(oldKey);
      }
      if (groups.size >= MAX_GROUPS) throw Object.assign(new Error("Live CVD capacity is busy. Existing collectors are retained; please retry later."), { status: 503 });
      group = { asset, market, active: true, startedAt: now(), subscribedSince: now(), lastUsed: now(),
        sources: initialSources(), minutes: new Map(), gaps: new Set(), ids: new Map(), queue: [],
        handles: [], retries: new Set(), lastProcessedTime: 0, dirty: false, loaded: false };
      groups.set(key, group);
      group.ready = initialize(group);
    } else if (!group.active) {
      group.active = true; group.subscribedSince = now(); group.sources = initialSources();
      markGap(group); void Promise.all(group.sources.map(source => startSource(group, source)));
    }
    group.lastUsed = now();
    flush(group);
    const minutes = [...group.minutes.values()];
    const candles = buildCvdCandles(minutes, timeframe, anchor, now() / 1000).slice(-1500);
    const firstTime = minutes.reduce((t, r) => Math.min(t, r.time), Infinity);
    const lastTime = minutes.reduce((t, r) => Math.max(t, r.time), -Infinity);
    const warnings = [
      "Observed trades only: unavailable sources, pre-recording history and disconnected periods are not estimated or zero-filled.",
      "Each exchange contributes one verified USD/stablecoin spot or linear perpetual market. This is not every quote pair or inverse contract.",
      "USD, USDT and USDC quoted values use a 1:1 USD-equivalent assumption, not a live stablecoin FX conversion.",
      "CVD sums taker-buy value minus taker-sell value; there is no open-interest weighting. Anchor resets use UTC calendar boundaries.",
      "Trade extrema use exchange timestamp order with a 2.5-second reorder buffer; cross-venue clocks can differ. Coverage gaps stay incomplete, but the observed CVD balance carries forward until its calendar anchor resets.",
      "BingX perpetual frames do not provide execution IDs; distinct received records are retained. Undocumented upstream replays cannot be deduplicated exactly.",
      "History is collected on demand and saved locally. Idle collectors stop after 30 minutes or earlier under capacity pressure; ephemeral hosting may lose local recordings.",
    ];
    if (group.late) warnings.push("Late/out-of-order trades exceeded the reorder buffer and were excluded; affected coverage is incomplete.");
    if (group.dropped) warnings.push("The live event safety buffer was exceeded; affected coverage is incomplete.");
    if (group.storageFailed) warnings.push("Local history could not be loaded or saved; live collection continues without a durable-history guarantee.");
    return { ...parsed, unit: "USD-equivalent", anchorStart: cvdAnchorStart(now() / 1000, anchor),
      completeAnchor: false, recordingStartedAt: new Date(group.startedAt).toISOString(),
      historyStart: minutes.length ? new Date(firstTime * 1000).toISOString() : null,
      historyEnd: minutes.length ? new Date(lastTime * 1000).toISOString() : null,
      candles, sources: group.sources.map(s => ({ ...s })), generatedAt: new Date(now()).toISOString(),
      warnings, storage: "local-recording", isLoading: group.sources.some(s => s.status === "loading") };
  }
  const tick = timers ? setInterval(() => {
    for (const group of groups.values()) {
      if (group.active && now() - group.lastUsed > IDLE_MS) stopGroup(group);
      else if (group.active) { flush(group); void save(group); }
    }
  }, 15_000) : null;
  tick?.unref?.();
  return { get, async close() {
    clearInterval(tick);
    groups.forEach(stopGroup);
    await Promise.all([...groups.values()].map(async group => {
      await group.saveTask;
      await save(group);
    }));
  }, _groups: groups };
}
export const cvdIndicatorService = createCvdIndicatorService();
