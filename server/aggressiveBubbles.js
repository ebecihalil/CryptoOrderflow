import { CVD_FRAMES } from "./cvdMath.js";

export const BUBBLE_PRICE_STEP = 1.0005; // 0.05% logarithmic price bands
export function validateAggressiveBubblesQuery(query) {
  const { asset, market = "both", timeframe = "1h", minValue = "10000" } = query;
  if (typeof asset !== "string" || !/^[A-Z0-9]{1,30}$/.test(asset) ||
    !["both", "spot", "perpetual"].includes(market) || typeof timeframe !== "string" ||
    !Object.hasOwn(CVD_FRAMES, timeframe) ||
    !["string", "number"].includes(typeof minValue) || String(minValue).trim() === "" ||
    !Number.isFinite(Number(minValue)) || Number(minValue) < 0 || Number(minValue) > 1e12) {
    throw Object.assign(new Error("Aggressive bubbles requires a crypto asset, valid market/timeframe and minimum value from 0 to 1 trillion USD-equivalent."), { status: 400 });
  }
  return { asset, market, timeframe, minValue: Number(minValue) };
}

export function createAggressiveBubbleLedger({
  market, now = Date.now, retentionSeconds = 7200, maxCells = 12_000, bucketSeconds = 60,
} = {}) {
  if (![60, 300].includes(bucketSeconds)) throw new Error("Invalid bubble recording bucket.");
  const cells = new Map();
  let startedAt = now();
  let truncated = false, lastPrunedAt = -Infinity;
  function prune(force = false) {
    if (!force && now() - lastPrunedAt < 5000 && cells.size <= maxCells) return;
    lastPrunedAt = now();
    const cutoff = now() / 1000 - retentionSeconds;
    for (const [key, cell] of cells) if (cell.minute + bucketSeconds <= cutoff) cells.delete(key);
    while (cells.size > maxCells) {
      cells.delete(cells.keys().next().value);
      truncated = true;
    }
  }
  function add(trade) {
    if (!["buy", "sell"].includes(trade.side) || !(trade.price > 0 && Number.isFinite(trade.price)) ||
      !(trade.value > 0 && Number.isFinite(trade.value)) || !Number.isSafeInteger(trade.time) ||
      typeof trade.exchange !== "string" || trade.time / 1000 < now() / 1000 - retentionSeconds) return;
    const quantity = trade.value / trade.price;
    if (!(quantity > 0 && Number.isFinite(quantity))) return;
    const minute = Math.floor(trade.time / (bucketSeconds * 1000)) * bucketSeconds;
    const band = Math.round(Math.log(trade.price) / Math.log(BUBBLE_PRICE_STEP));
    const key = `${minute}:${band}:${trade.side}`;
    if (!cells.has(key)) cells.set(key, { minute, band, side: trade.side, value: 0,
      quantity: 0, tradeCount: 0, sources: new Set(), first: trade.time, last: trade.time });
    const cell = cells.get(key);
    cell.value += trade.value;
    cell.quantity += quantity;
    cell.tradeCount++;
    cell.sources.add(trade.exchange);
    cell.first = Math.min(cell.first, trade.time); cell.last = Math.max(cell.last, trade.time);
    prune();
  }
  function snapshot(timeframe, minValue = 10000) {
    if (!Object.hasOwn(CVD_FRAMES, timeframe)) throw new Error("Invalid bubble timeframe.");
    prune(true);
    const step = CVD_FRAMES[timeframe], combined = new Map();
    let first = Infinity, last = -Infinity;
    for (const cell of cells.values()) {
      first = Math.min(first, cell.first); last = Math.max(last, cell.last);
      const time = Math.floor(cell.minute / step) * step;
      const id = `${market}:${time}:${cell.band}:${cell.side}`;
      if (!combined.has(id)) combined.set(id, { id, market, side: cell.side, time,
        value: 0, quantity: 0, tradeCount: 0, sources: new Set() });
      const point = combined.get(id);
      point.value += cell.value; point.quantity += cell.quantity; point.tradeCount += cell.tradeCount;
      cell.sources.forEach(s => point.sources.add(s));
    }
    const points = [...combined.values()].filter(p => p.value >= minValue).map(({ quantity, sources, ...point }) =>
      ({ ...point, price: point.value / quantity, sourceCount: sources.size }));
    return { points, startedAt, first: Number.isFinite(first) ? first : null,
      last: Number.isFinite(last) ? last : null, truncated, retainedCells: cells.size };
  }
  function info() {
    prune();
    let first = Infinity, last = -Infinity;
    for (const cell of cells.values()) { first = Math.min(first, cell.first); last = Math.max(last, cell.last); }
    return { startedAt, first: Number.isFinite(first) ? first : null,
      last: Number.isFinite(last) ? last : null, truncated, retainedCells: cells.size };
  }
  function serialize() {
    prune(true);
    return { version: 1, bucketSeconds, startedAt, truncated, cells: [...cells.values()].map(c => ({ ...c, sources: [...c.sources] })) };
  }
  function restore(body, allowedSources) {
    const archiveStep = body?.bucketSeconds ?? 60;
    if (body?.version !== 1 || !Number.isFinite(body.startedAt) || body.startedAt > now() ||
      ![60, 300].includes(archiveStep) || archiveStep > bucketSeconds ||
      !Array.isArray(body.cells) || body.cells.length > maxCells) throw new Error("Invalid bubble recording.");
    const restored = new Map();
    const originalKeys = new Set();
    for (const c of body.cells) {
      if (!Number.isSafeInteger(c.minute) || c.minute % 60 || !Number.isSafeInteger(c.band) ||
        !["buy", "sell"].includes(c.side) || !Number.isFinite(c.value) || c.value <= 0 ||
        !Number.isFinite(c.quantity) || c.quantity <= 0 || !Number.isSafeInteger(c.tradeCount) || c.tradeCount < 1 ||
        !Number.isSafeInteger(c.first) || !Number.isSafeInteger(c.last) || c.first > c.last ||
        Math.floor(c.first / (archiveStep * 1000)) * archiveStep !== c.minute ||
        Math.floor(c.last / (archiveStep * 1000)) * archiveStep !== c.minute ||
        c.last > now() + 5000 || !Array.isArray(c.sources) || !c.sources.length ||
        c.sources.some(s => typeof s !== "string" || allowedSources && !allowedSources.includes(s))) throw new Error("Invalid bubble cell.");
      if (c.minute + archiveStep <= now() / 1000 - retentionSeconds) continue;
      const originalKey = `${c.minute}:${c.band}:${c.side}`;
      if (originalKeys.has(originalKey)) throw new Error("Duplicate bubble cell.");
      originalKeys.add(originalKey);
      const minute = Math.floor(c.minute / bucketSeconds) * bucketSeconds;
      const key = `${minute}:${c.band}:${c.side}`;
      const existing = restored.get(key);
      if (!existing) restored.set(key, { ...c, minute, sources: new Set(c.sources) });
      else {
        existing.value += c.value; existing.quantity += c.quantity; existing.tradeCount += c.tradeCount;
        c.sources.forEach(s => existing.sources.add(s));
        existing.first = Math.min(existing.first, c.first); existing.last = Math.max(existing.last, c.last);
      }
    }
    cells.clear();
    [...restored.entries()].sort((a, b) => a[1].minute - b[1].minute).forEach(([k, c]) => cells.set(k, c));
    startedAt = body.startedAt; truncated = body.truncated === true;
  }
  return { add, snapshot, info, serialize, restore };
}
