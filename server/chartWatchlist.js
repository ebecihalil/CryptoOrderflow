import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { cvdIndicatorService } from "./cvdIndicator.js";
import { marketContractService } from "./marketContracts.js";
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";

const VENUES = new Set(["binance", "bybit", "okx", "gate", "mexc", "bitget", "bingx"]);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function validContract(c) {
  return c && VENUES.has(c.exchange) && typeof c.symbol === "string" && /^[A-Z0-9_-]{1,60}$/i.test(c.symbol) &&
    typeof c.asset === "string" && /^[A-Z0-9]{1,30}$/.test(c.asset) && isCryptoAsset(c.asset) &&
    canonicalAsset(c.asset).asset === c.asset && typeof c.label === "string" && c.label.length < 160 &&
    Number.isFinite(c.priceDivisor) && c.priceDivisor > 0;
}

export function createChartWatchlist({
  recorder = cvdIndicatorService, catalogue = marketContractService,
  storageDir = recorder.storageDir, now = Date.now, startImmediately = true,
} = {}) {
  let items = [], queue = Promise.resolve(), storageFailed = false, closed = false;
  const file = storageDir && path.join(storageDir, "watchlist.json");
  const storageWarning = "Shared server watchlist. Recording runs only while the server is awake. History survives restart only if your hosting preserves this data directory; redeploys need persistent storage.";
  async function persist(next) {
    if (!file) throw fail("A persistent recording directory is required to save the watchlist.", 503);
    try {
      await mkdir(storageDir, { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify({ version: 1, items: next }));
      await rename(`${file}.tmp`, file);
      storageFailed = false;
    } catch (e) { storageFailed = true; throw fail("Could not save the server watchlist. Your previous list has been retained.", 503); }
  }
  const ready = (async () => {
    if (!file) return;
    try {
      const raw = await readFile(file);
      if (raw.length > 25_000) throw new Error("Oversized watchlist.");
      const body = JSON.parse(raw);
      if (body.version !== 1 || !Array.isArray(body.items) || body.items.length > 5 ||
        body.items.some(i => !validContract(i.contract) || i.asset !== i.contract.asset ||
          !Number.isFinite(Date.parse(i.addedAt))) || new Set(body.items.map(i => i.asset)).size !== body.items.length) {
        throw new Error("Invalid saved watchlist.");
      }
      items = body.items;
      if (startImmediately) for (const item of items) recorder.pinAsset(item.asset);
    } catch (e) { if (e.code !== "ENOENT") storageFailed = true; }
  })();
  function snapshot() {
    return { items: items.map(i => ({ ...i, ...recorder.recordingStatus(i.asset) })),
      limit: 5, retentionDays: 7, shared: true, storageWarning, storageFailed };
  }
  function mutate(work) {
    const task = queue.then(async () => { await ready; if (closed) throw fail("Watchlist is shutting down.", 503); return work(); });
    queue = task.catch(() => {});
    return task;
  }
  return {
    ready,
    async start() {
      await ready;
      if (closed) return;
      try { for (const item of items) recorder.pinAsset(item.asset); }
      catch { storageFailed = true; }
    },
    async get() { await ready; return snapshot(); },
    add(body) { return mutate(async () => {
      if (!body || !VENUES.has(body.exchange) || typeof body.symbol !== "string") throw fail("Select a valid perpetual chart contract.");
      const contract = catalogue.get().contracts.find(c => c.exchange === body.exchange && c.symbol === body.symbol);
      if (!validContract(contract)) throw fail("This contract is not currently available in the chart catalogue. Refresh the catalogue and try again.", 409);
      const found = items.find(i => i.asset === contract.asset);
      if (!found && items.length >= 5) throw fail("The shared server watchlist is full. Remove a coin to free a recording slot.", 409);
      const entry = { asset: contract.asset, contract: { ...contract }, addedAt: found?.addedAt || new Date(now()).toISOString() };
      const next = found ? items.map(i => i.asset === entry.asset ? entry : i) : [...items, entry];
      recorder.pinAsset(entry.asset);
      try { await persist(next); } catch (e) { if (!found) recorder.unpinAsset(entry.asset); throw e; }
      items = next;
      return snapshot();
    }); },
    remove(input) { return mutate(async () => {
      if (typeof input !== "string" || !/^[A-Z0-9]{1,30}$/.test(input)) throw fail("Select a valid watched coin.");
      const asset = canonicalAsset(input).asset;
      if (!items.some(i => i.asset === asset)) return snapshot();
      const next = items.filter(i => i.asset !== asset);
      await persist(next);
      items = next;
      recorder.unpinAsset(asset);
      return snapshot();
    }); },
    async close() { closed = true; await ready; await queue; },
  };
}
export const chartWatchlistService = createChartWatchlist({ startImmediately: false });
