// Guards CVD and bubbles against trades that are not really this coin's price:
// a smaller exchange can list a different token under the same ticker, or quote
// a stale/illiquid price. Each exchange's latest trade price (spot and perp) is
// compared with the median of the OTHER exchanges' recent prices; a trade more
// than MAX_DEVIATION away is left out, so bubbles sit where the coin traded.
export const MAX_DEVIATION = 0.03;     // 3%
const FRESH_MS = 120_000;              // other exchanges' prices must be this recent
const MIN_REFERENCES = 2;              // need at least two other exchanges to judge

export function createPriceConsistency({ maxDeviation = MAX_DEVIATION } = {}) {
  const assets = new Map(); // asset -> Map(`${market}:${exchange}` -> { price, time })
  const rejected = new Map(); // asset -> Map(exchange -> count)
  function median(values) {
    const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  /** True when the trade's price agrees with the other exchanges (or there is too little to compare). */
  function accept(asset, market, trade) {
    if (!assets.has(asset)) assets.set(asset, new Map());
    const prices = assets.get(asset);
    const others = [];
    for (const [key, entry] of prices) {
      if (key.endsWith(`:${trade.exchange}`)) continue; // never judge an exchange by itself (spot or perp)
      if (trade.time - entry.time <= FRESH_MS && entry.time - trade.time <= FRESH_MS) others.push(entry.price);
    }
    let ok = true;
    if (others.length >= MIN_REFERENCES) {
      const reference = median(others);
      ok = Math.abs(trade.price / reference - 1) <= maxDeviation;
    }
    if (ok) prices.set(`${market}:${trade.exchange}`, { price: trade.price, time: trade.time });
    else {
      if (!rejected.has(asset)) rejected.set(asset, new Map());
      const counts = rejected.get(asset);
      counts.set(trade.exchange, (counts.get(trade.exchange) ?? 0) + 1);
    }
    return ok;
  }
  return { accept, rejectedFor: asset => Object.fromEntries(rejected.get(asset) ?? []) };
}
