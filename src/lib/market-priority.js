// "One row per coin" for the Super Charts market list. The user orders the
// exchanges (e.g. Bybit, Binance, OKX, ...); each coin is shown once, from the
// highest-priority enabled exchange that lists it. Coins the first exchange
// doesn't have come from the second, then the third, and so on.

/** Saved order with unknown exchanges dropped and any new ones appended. */
export function normalizeOrder(order, all) {
  const kept = [...new Set((Array.isArray(order) ? order : []).filter(exchange => all.includes(exchange)))];
  return [...kept, ...all.filter(exchange => !kept.includes(exchange))];
}

/**
 * Group contracts by coin (canonical asset, so 1000PEPE and PEPE are one coin)
 * and pick the primary contract by exchange priority.
 * @returns {{ primary: object, others: object[] }[]}
 */
export function groupByPriority(contracts, order, enabled, isHidden = () => false) {
  const rank = new Map(order.filter(exchange => enabled.includes(exchange)).map((exchange, index) => [exchange, index]));
  const groups = new Map();
  for (const contract of contracts) {
    const exchange = contract.exchange.toLowerCase();
    if (!rank.has(exchange) || isHidden(contract)) continue;
    const coin = contract.asset.toUpperCase();
    if (!groups.has(coin)) groups.set(coin, []);
    groups.get(coin).push(contract);
  }
  return [...groups.values()].map(list => {
    list.sort((a, b) => rank.get(a.exchange.toLowerCase()) - rank.get(b.exchange.toLowerCase()));
    return { primary: list[0], others: list.slice(1) };
  });
}

export const PRIORITY_SLOTS = 10;

/**
 * Ten priority slots, each an exchange id or null (empty). Unknown or
 * unsupported exchanges and duplicates become empty. Older saves (an ordered
 * list plus enabled exchanges) are converted.
 */
export function normalizeSlots(saved, supported, fallback, legacy) {
  let source = Array.isArray(saved) ? saved
    : legacy && Array.isArray(legacy.order) ? legacy.order.filter(exchange => !Array.isArray(legacy.exchanges) || legacy.exchanges.includes(exchange))
    : fallback;
  const seen = new Set();
  const slots = Array.from({ length: PRIORITY_SLOTS }, (_, index) => {
    const exchange = source[index];
    if (typeof exchange !== "string" || !supported.includes(exchange) || seen.has(exchange)) return null;
    seen.add(exchange);
    return exchange;
  });
  return slots;
}

/** Put `exchange` in slot `index`; if it was in another slot, the two swap. */
export function assignSlot(slots, index, exchange) {
  const next = [...slots];
  const previous = exchange ? next.indexOf(exchange) : -1;
  if (previous >= 0 && previous !== index) next[previous] = next[index];
  next[index] = exchange || null;
  return next;
}

/** Swap slot `index` with its neighbour (step -1 up, +1 down). */
export function moveSlot(slots, index, step) {
  const target = index + step;
  if (target < 0 || target >= slots.length) return slots;
  const next = [...slots];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
