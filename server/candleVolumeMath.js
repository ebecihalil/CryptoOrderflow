// All seven chart venues; a venue whose gaps would shorten the matched history
// is left out for that coin (see aggregateCandleVolumes).
export const VOLUME_EXCHANGES = ["binance", "okx", "gate", "bybit", "bitget", "mexc", "bingx"];
/** Bars of matched history wanted before a gappy venue is dropped. */
export const VOLUME_TARGET_BARS = 300;
import { CHART_TIMEFRAMES, timeframeSeconds } from "./timeframes.js";
// Nominal candle lengths (calendar months/quarters use their maximum length).
export const CANDLE_SECONDS = Object.fromEntries(CHART_TIMEFRAMES.map(tf => [tf, timeframeSeconds(tf)]));

/** Exact timestamps, one fixed set of venues, underlying-coin units throughout. */
export function aggregateCandleVolumes(price, sources, timeframe) {
  if (!price.candles.length) throw new Error("No price candles to align.");
  const seconds = timeframeSeconds(timeframe);
  const latest = price.candles.at(-1).time;
  const eligible = sources.filter(source => !source.stale && source.candles?.length >= 50 &&
    latest - source.candles.at(-1).time <= seconds);
  if (!eligible.length) throw new Error("No compatible fresh volume histories available.");
  const maps = new Map(eligible.map(source => [source, new Map(source.candles.map(bar => [bar.time, bar]))]));
  // Newest contiguous run of price bars that every chosen venue has. Never zero-fill a missing candle.
  const suffix = chosen => {
    const aligned = [];
    let started = false;
    for (let i = price.candles.length - 1; i >= 0; i--) {
      const bar = price.candles[i];
      const peers = chosen.map(source => maps.get(source).get(bar.time));
      if (peers.some(peer => !peer)) {
        if (started) break;
        continue;
      }
      started = true;
      const volume = peers.reduce((sum, peer, index) => sum + peer.volume * chosen[index].divisor, 0);
      if (!Number.isFinite(volume) || volume < 0) throw new Error("Invalid normalized volume.");
      aligned.push({ ...bar, volume, closed: bar.closed && peers.every(peer => peer.closed) });
    }
    return aligned.reverse();
  };
  // More venues = more complete volume, but one venue with gaps would cut the
  // matched history short. Drop the venue with the shortest own coverage until
  // the history is long enough (or one venue is left).
  const target = Math.min(price.candles.length, VOLUME_TARGET_BARS);
  let chosen = [...eligible], aligned = suffix(chosen);
  // A venue only missing the newest (still forming) bar or two is kept; drop only when gaps cost >20%.
  while (aligned.length < target * 0.8 && chosen.length > 1) {
    const coverage = chosen.map(source => suffix([source]).length);
    const worst = coverage.indexOf(Math.min(...coverage));
    const next = chosen.filter((_, index) => index !== worst);
    const candidate = suffix(next);
    if (candidate.length <= aligned.length) break;
    chosen = next; aligned = candidate;
  }
  if (aligned.length < 50) throw new Error("Not enough overlapping volume history to calculate zones.");
  return { candles: aligned, exchanges: chosen.map(source => source.exchange) };
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
