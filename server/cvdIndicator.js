import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { gzip, gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { ALWAYS_RECORD } from "./alwaysRecord.js";
import { CVD_EXCHANGES, createCvdMarketResolver, cvdExchangesFor } from "./cvdMarkets.js";
import { createCvdStreamFactory, LIQUIDATION_EXCHANGES } from "./cvdStreams.js";
import { createPriceConsistency } from "./priceConsistency.js";
import { addCvdTrade, newCvdMinute, buildCvdCandles, cvdAnchorStart, validateCvdQuery, compactCvdMinutes } from "./cvdMath.js";
import { AUTO_BUBBLES_PER_CANDLE, bubbleThreshold, createAggressiveBubbleLedger, validateAggressiveBubblesQuery } from "./aggressiveBubbles.js";
import { secondCandleRecorder } from "./secondCandles.js";

// Two weeks preserve the previous full calendar week plus the current week.
// History: 30 days; 1-minute detail for the last 14 days, 5-minute steps before that.
const RETENTION = 30 * 86400, FULL_DETAIL = 14 * 86400, MAX_GROUPS = 4, MAX_QUEUE = 50_000, IDLE_MS = 30 * 60_000;
const timeOrder = (a, b) => {
  if (a.time !== b.time) return a.time - b.time;
  if (a.exchange !== b.exchange) return a.exchange.localeCompare(b.exchange);
  if (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)) return BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0;
  return a.id.localeCompare(b.id);
};
// Spot groups use the spot-capable venues; perpetual groups use every venue.
const initialSources = market => cvdExchangesFor(market).map(exchange => ({
  exchange, status: "loading", symbol: null, tradeCount: 0, lastTradeAt: null,
}));
const compress = promisify(gzip);

export function createCvdIndicatorService({
  resolver = createCvdMarketResolver(), streams = createCvdStreamFactory(), now = Date.now,
  storageDir = process.env.WATCHLIST_DATA_DIR || fileURLToPath(new URL("../.cache/cvd-recordings/", import.meta.url)), timers = true,
  // Live perpetual trades also feed the seconds-candle recorder (1s–30s charts).
  onPerpetualTrade = trade => secondCandleRecorder.ingest(trade),
  // Top coins recorded all the time (no gaps when nobody has them open); not part of the 5-coin watchlist.
  alwaysRecord = timers ? ALWAYS_RECORD : [],
} = {}) {
  const groups = new Map();
  const pinned = new Set();
  const core = new Set(alwaysRecord.map(item => canonicalAsset(item).asset).filter(isCryptoAsset));
  // Trades far from the other exchanges' price (wrong token / stale venue) are left out of CVD and bubbles.
  const consistency = createPriceConsistency();
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
    if (!consistency.accept(group.asset, group.market, trade)) return;
    if (group.market === "perpetual") { try { onPerpetualTrade(trade); } catch { /* never affects CVD */ } }
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
      group.profile?.add(trade);
      group.fineBubbles?.add(trade);
      group.lastProcessedTime = trade.time;
    }
    group.queue = pending;
    const earliest = Math.floor(now() / 1000) - RETENTION;
    for (const t of group.minutes.keys()) if (t < earliest) group.minutes.delete(t);
    if (!(now() - (group.compactedAt ?? 0) < 600_000)) {
      group.compactedAt = now();
      if (compactCvdMinutes(group.minutes, Math.floor(now() / 1000) - FULL_DETAIL)) group.dirty = true;
    }
    for (const t of group.gaps) if (t < earliest) group.gaps.delete(t);
    for (const [id, t] of group.ids) if (t < now() - 180_000) group.ids.delete(id);
  }
  // Liquidations (and when each liquidation feed was connected) are kept 30 days
  // and saved with the recording: the leverage model needs to know both what was
  // liquidated and when the feeds could see it.
  // Kept 30 days: individual events for 2 days, then 5-minute totals per exchange and side.
  const LIQ_RETENTION_MS = 30 * 86400_000, LIQ_DETAIL_MS = 2 * 86400_000;
  const trimLiquidations = group => {
    const cutoff = now() - LIQ_RETENTION_MS, detail = now() - LIQ_DETAIL_MS;
    let list = group.liquidations.filter(item => item.time >= cutoff);
    if (list.some(item => item.time < detail && !item.aggregated)) {
      const buckets = new Map(), kept = [];
      for (const item of list) {
        if (item.time >= detail || item.aggregated && !buckets.has(`${item.exchange}:${item.side}:${item.time}`)) {
          if (item.aggregated) buckets.set(`${item.exchange}:${item.side}:${item.time}`, item); else kept.push(item);
          continue;
        }
        const time = Math.floor(item.time / 300_000) * 300_000, key = `${item.exchange}:${item.side}:${time}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.usd += item.usd;
        else buckets.set(key, { exchange: item.exchange, symbol: "*", side: item.side, time, usd: item.usd, aggregated: true });
      }
      list = [...buckets.values(), ...kept].sort((a, b) => a.time - b.time);
    }
    group.liquidations = list.slice(-200_000);
    for (const [exchange, spans] of group.liqCoverage) group.liqCoverage.set(exchange, spans.filter(span => span[1] >= cutoff));
  };
  /** Closed coverage spans plus each live feed's open span, ending now. */
  const coverageSpans = group => {
    const out = {};
    for (const [exchange, spans] of group.liqCoverage) out[exchange] = spans.map(span => [...span]);
    for (const source of group.sources ?? []) {
      if (source.liquidationConnectedSince) (out[source.exchange] ??= []).push([source.liquidationConnectedSince, now()]);
    }
    return out;
  };
  async function save(group) {
    if (group.saving) return group.saveTask;
    if (!storageDir || !group.loaded || !group.dirty) return;
    group.saving = true;
    group.dirty = false;
    group.saveTask = saveQueue.then(async () => {
    try {
      const payload = { version: 1, asset: group.asset, market: group.market, startedAt: group.startedAt,
        lastProcessedTime: group.lastProcessedTime, gaps: [...group.gaps],
        minutes: [...group.minutes.values()].map(r => ({ ...r, sources: [...r.sources],
          ...(r.byExchange ? { byExchange: Object.fromEntries(Object.entries(r.byExchange).map(([k, v]) => [k, [...v]])) } : {}) })),
        bubbles: group.bubbles.serialize(), profile: group.profile.serialize(),
        ...(group.market === "perpetual" ? { liquidations: group.liquidations, liqCoverage: coverageSpans(group) } : {}) };
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
        !Array.isArray(body.minutes) || body.minutes.length > 400_000 || !Number.isFinite(body.startedAt)) throw new Error("Invalid recording.");
      for (const r of body.minutes) {
        if (!Number.isSafeInteger(r.time) || r.time > now() / 1000 || r.time < now() / 1000 - RETENTION ||
          !["delta", "high", "low", "buyValue", "sellValue", "trades"].every(k => Number.isFinite(r[k])) ||
          r.trades < 1 || r.buyValue < 0 || r.sellValue < 0 || !Array.isArray(r.sources) ||
          r.sources.some(s => !CVD_EXCHANGES.includes(s))) continue;
        if (r.byExchange && (typeof r.byExchange !== "object" || Object.entries(r.byExchange).some(([k, v]) =>
          !CVD_EXCHANGES.includes(k) || !Array.isArray(v) || v.length !== 2 || !v.every(x => Number.isFinite(x) && x >= 0)))) delete r.byExchange;
        group.minutes.set(r.time, r);
      }
      group.startedAt = body.startedAt;
      group.lastProcessedTime = Number.isFinite(body.lastProcessedTime) ? body.lastProcessedTime : 0;
      if (Array.isArray(body.gaps)) body.gaps.filter(Number.isSafeInteger).forEach(t => group.gaps.add(t));
      if (body.bubbles) { try { group.bubbles.restore(body.bubbles, CVD_EXCHANGES); } catch { /* older format: start fresh */ } }
      if (body.profile) { try { group.profile.restore(body.profile, CVD_EXCHANGES); } catch { /* start fresh */ } }
      if (group.market === "perpetual" && Array.isArray(body.liquidations)) {
        group.liquidations = body.liquidations.filter(item => item && LIQUIDATION_EXCHANGES.includes(item.exchange) &&
          (item.side === "long" || item.side === "short") && Number.isFinite(item.time) && item.time <= now() &&
          Number.isFinite(item.usd) && item.usd > 0).sort((a, b) => a.time - b.time);
      }
      if (group.market === "perpetual" && body.liqCoverage && typeof body.liqCoverage === "object") {
        for (const [exchange, spans] of Object.entries(body.liqCoverage)) {
          if (!LIQUIDATION_EXCHANGES.includes(exchange) || !Array.isArray(spans)) continue;
          group.liqCoverage.set(exchange, spans.filter(span => Array.isArray(span) && span.length === 2 &&
            span.every(Number.isFinite) && span[0] <= span[1] && span[1] <= now()).map(span => [span[0], span[1]]));
        }
      }
      trimLiquidations(group);
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
        if (LIQUIDATION_EXCHANGES.includes(source.exchange)) {
          const connected = ["idle", "live"].includes(state);
          if (!connected && source.liquidationConnectedSince) {
            // Feed dropped: remember the span it covered.
            const spans = group.liqCoverage.get(source.exchange) ?? [];
            spans.push([source.liquidationConnectedSince, now()]);
            group.liqCoverage.set(source.exchange, spans);
          }
          source.liquidationConnectedSince = connected ? source.liquidationConnectedSince ?? now() : null;
        }
      }, event => {
        if (!group.active || event.time < group.subscribedSince || event.time > now() + 5000) return;
        // Duplicates only arrive close together: check the recent tail, append in time order,
        // and compact/trim at most once a minute (cheap on busy coins).
        const list = group.liquidations;
        const duplicate = list.slice(-200).some(item => item.exchange === event.exchange && item.symbol === event.symbol &&
          item.side === event.side && item.time === event.time && item.usd === event.usd);
        if (!duplicate) {
          if (!list.length || list.at(-1).time <= event.time) list.push(event);
          else { list.push(event); list.sort((a, b) => a.time - b.time); }
          if (!(now() - (group.liqTrimmedAt ?? 0) < 60_000)) { group.liqTrimmedAt = now(); trimLiquidations(group); }
          group.dirty = true;
        }
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
        sources: initialSources(market), minutes: new Map(), gaps: new Set(), ids: new Map(), queue: [],
        handles: [], retries: new Set(), lastProcessedTime: 0, dirty: false, loaded: false, liquidations: [], liqCoverage: new Map() };
      // Bubbles: 5-minute cells for the last 24 hours (5m and every larger chart timeframe are whole
      // multiples of 5 minutes, so each bubble lands on the candle it traded in).
      group.bubbles = createAggressiveBubbleLedger({ market, now, retentionSeconds: 86400,
        maxCells: 60_000, bucketSeconds: 300 });
      // Session Volume Profile: hourly cells with 0.25% price steps for 30 days (light).
      group.profile = createAggressiveBubbleLedger({ market, now, retentionSeconds: 30 * 86400,
        maxCells: 80_000, bucketSeconds: 300, archiveAfterSeconds: 3600 });
      // 1-minute cells for the last 12 hours, for 1m and 3m charts: with 5-minute
      // cells a trade from minute 4 would be drawn on minute 0's candle (off its range).
      group.fineBubbles = createAggressiveBubbleLedger({ market, now, retentionSeconds: 12 * 3600,
        maxCells: 60_000, bucketSeconds: 60 });
      groups.set(key, group);
      group.ready = initialize(group);
    } else if (!group.active) {
      group.active = true; group.subscribedSince = now(); group.sources = initialSources(group.market);
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
        // Large recordings: save every 5 minutes (and on shutdown).
        if (!group.lastSaveAttempt || now() - group.lastSaveAttempt >= 300_000) {
          group.lastSaveAttempt = now(); void save(group);
        }
      }
    }
  }, 1000) : null;
  tick?.unref?.();
  const BUBBLE_DISPLAY_LIMIT = 1500;
  /** Chart timeframes that need 1-minute bubble cells. */
  const FINE_BUBBLE_FRAMES = ["1m", "3m"];
  /**
   * Session (UTC day) volume profile from recorded executed trades: aggressive buy and
   * sell USD per 0.05% price band, summed over the chosen markets and every exchange.
   */
  function getVolumeProfile(query) {
    const asset = typeof query.asset === "string" ? canonicalAsset(query.asset.trim().toUpperCase()).asset : "";
    const market = query.market ?? "both";
    if (!/^[A-Z0-9]{1,30}$/.test(asset) || !["both", "spot", "perpetual"].includes(market))
      throw Object.assign(new Error("A crypto asset and market (both, spot or perpetual) are required."), { status: 400 });
    const markets = market === "both" ? ["spot", "perpetual"] : [market];
    const sessions = new Map();
    let startedAt = Infinity;
    for (const item of markets) {
      get({ asset, market: item, timeframe: "24h", anchor: "1w" });
      const ledger = groups.get(`${item}:${asset}`).profile.snapshot("24h", 0);
      startedAt = Math.min(startedAt, ledger.startedAt);
      for (const point of ledger.points) {
        const band = Number(point.id.split(":")[2]);
        if (!sessions.has(point.time)) sessions.set(point.time, new Map());
        const levels = sessions.get(point.time);
        const level = levels.get(band) ?? { band, buy: 0, sell: 0, weighted: 0, value: 0 };
        level[point.side] += point.value; level.weighted += point.price * point.value; level.value += point.value;
        levels.set(band, level);
      }
    }
    return { asset, market, unit: "USD", generatedAt: new Date(now()).toISOString(),
      recordingStartedAt: Number.isFinite(startedAt) ? new Date(startedAt).toISOString() : null,
      sessions: [...sessions].sort((a, b) => a[0] - b[0]).slice(-8).map(([time, levels]) => ({ time,
        levels: [...levels.values()].map(l => ({ price: l.weighted / l.value, buy: l.buy, sell: l.sell })).sort((a, b) => a.price - b.price) })) };
  }
  function getBubbles(query) {
    const parsed = validateAggressiveBubblesQuery(query);
    parsed.asset = canonicalAsset(parsed.asset).asset;
    const markets = parsed.market === "both" ? ["spot", "perpetual"] : [parsed.market];
    const dynamic = parsed.minValue === "auto" || parsed.minValue === "multiplier";
    // Reuse CVD's collectors, deduplication, shared gates and reorder buffer.
    // TF, minimum size and browser refresh never create extra trade connections.
    const snapshots = markets.map(market => {
      const cvd = get({ asset: parsed.asset, market, timeframe: parsed.timeframe, anchor: "1w" });
      const group = groups.get(`${market}:${parsed.asset}`);
      return { cvd, market, ledger: (FINE_BUBBLE_FRAMES.includes(parsed.timeframe) ? group.fineBubbles : group.bubbles)
        .snapshot(parsed.timeframe, dynamic ? 0 : parsed.minValue) };
    });
    // Auto / multiplier: the minimum follows this coin, timeframe and market's own trading volume.
    const threshold = bubbleThreshold(snapshots.flatMap(s => s.ledger.points),
      { mode: parsed.minValue === "multiplier" ? "multiplier" : "auto", multiplier: parsed.multiplier });
    const effectiveMinValue = dynamic ? threshold.value : parsed.minValue;
    // Dynamic modes compare each bubble with ITS candle's minimum (k × 20-candle average volume).
    const all = snapshots.flatMap(s => s.ledger.points).filter(p => p.value >= (dynamic ? threshold.at(p.time) : effectiveMinValue))
      .sort((a, b) => b.value - a.value);
    const points = all.slice(0, BUBBLE_DISPLAY_LIMIT).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    const firsts = snapshots.map(s => s.ledger.first).filter(t => t !== null);
    const lasts = snapshots.map(s => s.ledger.last).filter(t => t !== null);
    const warnings = [
      "Recorded executed trades only. Price-level recordings are restored from disk; previous CVD OHLC alone cannot reconstruct historical bubbles.",
      "Bubbles group same-side executions by chart candle and 0.05% underlying-price band. Size is gross traded USD-equivalent value, never net CVD or OI weighting.",
      "Buy and sell flow and Spot/Perpetual markets remain separate. Aggressive means market-taking, not proof of institutional activity.",
      "Prices are underlying-coin prices; bundled contract charts scale them into their native price units. USD/USDT/USDC use a parity assumption.",
      "Price-level history retains up to seven days with a bounded cell limit, without fabricated pre-recording trades. Missing sources and downtime remain incomplete.",
      "At most the 1500 largest matching bubbles are displayed. This is an executed-trade overlay, not an order-book liquidity heatmap.",
    ];
    if (snapshots.some(s => s.ledger.truncated)) warnings.push("The price-level safety limit trimmed older activity; available bubble history is incomplete.");
    if (snapshots.some(s => s.cvd.warnings.some(w => /Local history/.test(w)))) warnings.push("History storage failed; recording is not guaranteed to survive a restart.");
    if (snapshots.some(s => s.cvd.warnings.some(w => /Late\/out-of-order|safety buffer/.test(w)))) {
      warnings.push("Some executions were excluded by the shared reorder/safety buffer; affected coverage is incomplete.");
    }
    return { ...parsed, effectiveMinValue, averageCandleVolume: threshold.averageCandleVolume,
      volumeMultiplier: dynamic ? threshold.k : threshold.averageCandleVolume > 0 ? effectiveMinValue / threshold.averageCandleVolume : null,
      bubblesPerCandleTarget: parsed.minValue === "auto" ? AUTO_BUBBLES_PER_CANDLE : null, unit: "USD-equivalent", points,
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
    if (!pinned.has(asset) && [...pinned].filter(item => !core.has(item)).length >= 5) throw Object.assign(new Error("The server watchlist is limited to five coins."), { status: 409 });
    const existed = pinned.has(asset);
    pinned.add(asset);
    try {
      for (const market of ["spot", "perpetual"]) get({ asset, market, timeframe: "1h", anchor: "1w" });
    } catch (e) { if (!existed) pinned.delete(asset); throw e; }
  }
  function unpinAsset(input) {
    const asset = canonicalAsset(input).asset;
    if (core.has(asset)) return;
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
    const totalSources = cvdExchangesFor("spot").length + cvdExchangesFor("perpetual").length;
    return { liveSources, totalSources,
      status: liveSources ? liveSources === totalSources && !incomplete ? "recording" : "partial" : loading ? "starting" : "unavailable",
      historyStart: first.length ? new Date(Math.min(...first)).toISOString() : null,
      historyEnd: last.length ? new Date(Math.max(...last)).toISOString() : null,
      storageFailed: cohorts.some(g => g.storageFailed === true) };
  }
  function liquidationSnapshot(asset) {
    const group = groups.get(`perpetual:${canonicalAsset(asset).asset}`);
    const supported = new Set(LIQUIDATION_EXCHANGES);
    return {
      events: (group?.liquidations ?? []).filter(item => item.time >= now() - LIQ_RETENTION_MS).map(item => ({ ...item })),
      spans: group ? coverageSpans(group) : {},
      coverage: CVD_EXCHANGES.filter(exchange => supported.has(exchange)).flatMap(exchange => {
        const source = group?.sources.find(item => item.exchange === exchange);
        return source?.liquidationConnectedSince
          ? [{ exchange, since: source.liquidationConnectedSince }] : [];
      }),
      sources: CVD_EXCHANGES.map(exchange => {
        const source = group?.sources.find(item => item.exchange === exchange);
        return { exchange, status: supported.has(exchange) && source?.liquidationConnectedSince
          ? "Connected; sampled feed" : "Unavailable" };
      }),
    };
  }
  /** Recorded minutes with per-exchange [buy, sell] USD (starts the collector if needed). */
  function flowMinutes(input, market) {
    const asset = canonicalAsset(input).asset;
    try { get({ asset, market, timeframe: "1h", anchor: "1d" }); } catch { /* capacity busy: use what is recorded */ }
    const group = groups.get(`${market}:${asset}`);
    return group ? [...group.minutes.values()].filter(minute => minute.byExchange) : [];
  }
  // Start the always-recorded top coins shortly after startup.
  if (core.size && timers) setTimeout(() => {
    for (const asset of core) {
      pinned.add(asset);
      for (const market of ["spot", "perpetual"]) { try { get({ asset, market, timeframe: "1h", anchor: "1w" }); } catch { /* retried on use */ } }
    }
  }, 3000).unref?.();
  const alwaysRecorded = () => [...core];
  return { get, getBubbles, getVolumeProfile, flowMinutes, alwaysRecorded, pinAsset, unpinAsset, recordingStatus, liquidationSnapshot, storageDir, async close() {
    clearInterval(tick);
    groups.forEach(stopGroup);
    await Promise.all([...groups.values()].map(async group => {
      await group.saveTask;
      await save(group);
    }));
  }, _groups: groups };
}
export const cvdIndicatorService = createCvdIndicatorService();
