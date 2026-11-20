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
