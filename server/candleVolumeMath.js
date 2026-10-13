export const VOLUME_EXCHANGES = ["binance", "okx", "gate", "bybit"];
export const CANDLE_SECONDS = { "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "24h": 86400 };

/** Exact timestamps, one fixed set of venues, underlying-coin units throughout. */
export function aggregateCandleVolumes(price, sources, timeframe) {
  if (!price.candles.length) throw new Error("No price candles to align.");
  const seconds = CANDLE_SECONDS[timeframe];
  const latest = price.candles.at(-1).time;
  const eligible = sources.filter(source => !source.stale && source.candles?.length >= 50 &&
    latest - source.candles.at(-1).time <= seconds);
  if (!eligible.length) throw new Error("No compatible fresh volume histories available.");
  const maps = eligible.map(source => new Map(source.candles.map(bar => [bar.time, bar])));
  // Use the newest contiguous common suffix. Never zero-fill a missing candle.
  const aligned = [];
  let started = false;
  for (let i = price.candles.length - 1; i >= 0; i--) {
    const bar = price.candles[i];
    const peers = maps.map(map => map.get(bar.time));
    if (peers.some(peer => !peer)) {
      if (started) break;
      continue;
    }
    started = true;
    const volume = peers.reduce((sum, peer, index) => sum + peer.volume * eligible[index].divisor, 0);
    if (!Number.isFinite(volume) || volume < 0) throw new Error("Invalid normalized volume.");
    aligned.push({ ...bar, volume, closed: bar.closed && peers.every(peer => peer.closed) });
  }
  if (aligned.length < 50) throw new Error("Not enough overlapping volume history to calculate zones.");
  return { candles: aligned.reverse(), exchanges: eligible.map(source => source.exchange) };
}

export function parseOkxVolumeRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("No OKX candles.");
  return rows.map(row => {
    if (!Array.isArray(row) || row.length < 9 || !["0", "1"].includes(String(row[8]))) {
      throw new Error("Malformed OKX candle.");
    }
    // volCcy is base currency for swaps; vol is a contract count, not coin volume.
    return { row: [row[0], ...row.slice(1, 5), row[6]], confirmed: String(row[8]) === "1" };
  });
}

export function parseGateVolumeRows(rows, contractSize) {
  if (!Array.isArray(rows) || !rows.length || !(contractSize > 0)) throw new Error("Invalid Gate.io volume metadata.");
  return rows.map(row => {
    const contracts = row.v === null || row.v === undefined || row.v === "" ? NaN : Number(row.v);
    if (!Number.isFinite(contracts) || contracts < 0) throw new Error("Missing Gate.io contract volume.");
    // Gate's sum is quote-currency turnover. v * quanto_multiplier is base volume.
    return [Number(row.t) * 1000, row.o, row.h, row.l, row.c, contracts * contractSize];
  });
}
