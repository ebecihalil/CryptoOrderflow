import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { gzip, gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { CVD_EXCHANGES, createCvdMarketResolver } from "./cvdMarkets.js";
import { createCvdStreamFactory } from "./cvdStreams.js";
import { addCvdTrade, newCvdMinute, buildCvdCandles, cvdAnchorStart, validateCvdQuery } from "./cvdMath.js";
import { createAggressiveBubbleLedger, validateAggressiveBubblesQuery } from "./aggressiveBubbles.js";

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
const compress = promisify(gzip);

export function createCvdIndicatorService({
  resolver = createCvdMarketResolver(), streams = createCvdStreamFactory(), now = Date.now,
  storageDir = process.env.WATCHLIST_DATA_DIR || fileURLToPath(new URL("../.cache/cvd-recordings/", import.meta.url)), timers = true,
} = {}) {
  const groups = new Map();
  const pinned = new Set();
  let saveQueue = Promise.resolve();
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
      group.bubbles.add(trade);
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
    group.saveTask = saveQueue.then(async () => {
    try {
      const payload = { version: 1, asset: group.asset, market: group.market, startedAt: group.startedAt,
        lastProcessedTime: group.lastProcessedTime, gaps: [...group.gaps],
        minutes: [...group.minutes.values()].map(r => ({ ...r, sources: [...r.sources] })),
        bubbles: group.bubbles.serialize() };
      await mkdir(storageDir, { recursive: true });
      const temporary = `${file(group)}.tmp`;
      await writeFile(temporary, await compress(JSON.stringify(payload)));
      await rename(temporary, file(group));
      group.storageFailed = false;
    } catch { group.storageFailed = true; group.dirty = true; }
    finally { group.saving = false; }
    });
    saveQueue = group.saveTask.catch(() => {});
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
      if (body.bubbles) group.bubbles.restore(body.bubbles, CVD_EXCHANGES);
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
    if (!group || !group.active) {
      const activeCount = () => [...groups.values()].filter(g => g.active).length;
      for (const [oldKey, old] of groups) {
        if (oldKey === key) continue;
        if (pinned.has(old.asset)) continue;
        if (now() - old.lastUsed > IDLE_MS && old.active) stopGroup(old);
        // Pause a genuinely unviewed LRU cohort under pressure, not a collector
        // another tab is still polling. Its recorded history remains on disk.
        if (activeCount() >= MAX_GROUPS + pinned.size * 2 && old.active && now() - old.lastUsed > 15_000) stopGroup(old);
        if (!old.active && !old.saving) groups.delete(oldKey);
      }
      if (activeCount() >= MAX_GROUPS + pinned.size * 2) throw Object.assign(new Error("Live CVD capacity is busy. Existing collectors are retained; please retry later."), { status: 503 });
    }
    if (!group) {
      group = { asset, market, active: true, startedAt: now(), subscribedSince: now(), lastUsed: now(),
        sources: initialSources(), minutes: new Map(), gaps: new Set(), ids: new Map(), queue: [],
        handles: [], retries: new Set(), lastProcessedTime: 0, dirty: false, loaded: false };
      // Smallest supported frame is 5m: compact base cells without losing any
      // displayed price/side/value detail on any supported chart timeframe.
      group.bubbles = createAggressiveBubbleLedger({ market, now, retentionSeconds: 7 * 86400,
        maxCells: 150_000, bucketSeconds: 300 });
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
      "History is saved locally. Watchlisted coins continue recording server-side; other idle collectors stop after 30 minutes or under capacity pressure. Ephemeral hosting may lose local recordings.",
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
      if (group.active && !pinned.has(group.asset) && now() - group.lastUsed > IDLE_MS) stopGroup(group);
      else if (group.active) {
        flush(group);
        if (!group.lastSaveAttempt || now() - group.lastSaveAttempt >= 15_000) {
          group.lastSaveAttempt = now(); void save(group);
        }
      }
    }
  }, 1000) : null;
  tick?.unref?.();
  function getBubbles(query) {
    const parsed = validateAggressiveBubblesQuery(query);
    parsed.asset = canonicalAsset(parsed.asset).asset;
    const markets = parsed.market === "both" ? ["spot", "perpetual"] : [parsed.market];
    // Reuse CVD's collectors, deduplication, shared gates and reorder buffer.
    // TF, minimum size and browser refresh never create extra trade connections.
    const snapshots = markets.map(market => {
      const cvd = get({ asset: parsed.asset, market, timeframe: parsed.timeframe, anchor: "1w" });
      const group = groups.get(`${market}:${parsed.asset}`);
      return { cvd, market, ledger: group.bubbles.snapshot(parsed.timeframe, parsed.minValue) };
    });
    const all = snapshots.flatMap(s => s.ledger.points).sort((a, b) => b.value - a.value);
    const points = all.slice(0, 500).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    const firsts = snapshots.map(s => s.ledger.first).filter(t => t !== null);
    const lasts = snapshots.map(s => s.ledger.last).filter(t => t !== null);
    const warnings = [
      "Recorded executed trades only. Price-level recordings are restored from disk; previous CVD OHLC alone cannot reconstruct historical bubbles.",
      "Bubbles group same-side executions by chart candle and 0.05% underlying-price band. Size is gross traded USD-equivalent value, never net CVD or OI weighting.",
      "Buy and sell flow and Spot/Perpetual markets remain separate. Aggressive means market-taking, not proof of institutional activity.",
      "Prices are underlying-coin prices; bundled contract charts scale them into their native price units. USD/USDT/USDC use a parity assumption.",
      "Price-level history retains up to seven days with a bounded cell limit, without fabricated pre-recording trades. Missing sources and downtime remain incomplete.",
      "At most the 500 largest matching bubbles are displayed. This is an executed-trade overlay, not an order-book liquidity heatmap.",
    ];
    if (snapshots.some(s => s.ledger.truncated)) warnings.push("The price-level safety limit trimmed older activity; available bubble history is incomplete.");
    if (snapshots.some(s => s.cvd.warnings.some(w => /Local history/.test(w)))) warnings.push("History storage failed; recording is not guaranteed to survive a restart.");
    if (snapshots.some(s => s.cvd.warnings.some(w => /Late\/out-of-order|safety buffer/.test(w)))) {
      warnings.push("Some executions were excluded by the shared reorder/safety buffer; affected coverage is incomplete.");
    }
    return { ...parsed, unit: "USD-equivalent", points,
      recordingStartedAt: new Date(Math.min(...snapshots.map(s => s.ledger.startedAt))).toISOString(),
      historyStart: firsts.length ? new Date(Math.min(...firsts)).toISOString() : null,
      historyEnd: lasts.length ? new Date(Math.max(...lasts)).toISOString() : null,
      sources: snapshots.flatMap(s => s.cvd.sources.map(source => ({ ...source, market: s.market }))),
      warnings, aggregation: { priceBandPercent: 0.05, time: "chart_candle" },
      isLoading: snapshots.some(s => s.cvd.isLoading), generatedAt: new Date(now()).toISOString() };
  }
  function pinAsset(input) {
    const asset = canonicalAsset(input).asset;
    if (!isCryptoAsset(asset)) throw Object.assign(new Error("Only crypto coins can be watched."), { status: 400 });
    if (!pinned.has(asset) && pinned.size >= 5) throw Object.assign(new Error("The server watchlist is limited to five coins."), { status: 409 });
    const existed = pinned.has(asset);
    pinned.add(asset);
    try {
      for (const market of ["spot", "perpetual"]) get({ asset, market, timeframe: "1h", anchor: "1w" });
    } catch (e) { if (!existed) pinned.delete(asset); throw e; }
  }
  function unpinAsset(input) {
    const asset = canonicalAsset(input).asset;
    pinned.delete(asset);
    for (const market of ["spot", "perpetual"]) {
      const group = groups.get(`${market}:${asset}`);
      if (group?.active) stopGroup(group);
    }
  }
  function recordingStatus(asset) {
    const cohorts = ["spot", "perpetual"].map(m => groups.get(`${m}:${asset}`)).filter(Boolean);
    const sources = cohorts.flatMap(g => g.sources);
    const liveSources = sources.filter(s => s.status === "live").length;
    const loading = sources.some(s => s.status === "loading");
    const infos = cohorts.map(g => g.bubbles.info());
    const first = infos.map(i => i.first).filter(t => t !== null);
    const last = infos.map(i => i.last).filter(t => t !== null);
    const incomplete = cohorts.some(g => g.late || g.dropped) || infos.some(i => i.truncated);
    return { liveSources, totalSources: CVD_EXCHANGES.length * 2,
      status: liveSources ? liveSources === CVD_EXCHANGES.length * 2 && !incomplete ? "recording" : "partial" : loading ? "starting" : "unavailable",
      historyStart: first.length ? new Date(Math.min(...first)).toISOString() : null,
      historyEnd: last.length ? new Date(Math.max(...last)).toISOString() : null,
      storageFailed: cohorts.some(g => g.storageFailed === true) };
  }
  return { get, getBubbles, pinAsset, unpinAsset, recordingStatus, storageDir, async close() {
    clearInterval(tick);
    groups.forEach(stopGroup);
    await Promise.all([...groups.values()].map(async group => {
      await group.saveTask;
      await save(group);
    }));
  }, _groups: groups };
}
export const cvdIndicatorService = createCvdIndicatorService();
