// Session Volume Profile maths (port of the owner's Pine script), applied to REAL
// recorded order flow: each level carries aggressive buy and sell USD at its price,
// so Up/Down is true taker buy/sell volume, not candle direction.

export const VOLUME_PROFILE_DEFAULTS = {
  market: "both", sessions: 4, rows: 48, valueArea: 70, width: 30, placement: "left",
  mode: "updown", showPoc: true, showVa: false, developing: true,
};

/**
 * @param session {time (UTC day start, s), levels: [{price, buy, sell}]}
 * @returns {start, end, low, high, rowStep, rows: [{low, high, up, down, inValueArea}], poc, vah, val, total, maxRow}
 */
export function buildSessionProfile(session, settings = VOLUME_PROFILE_DEFAULTS, priceDivisor = 1) {
  const levels = (session.levels ?? []).filter(level => level.price > 0 && (level.buy > 0 || level.sell > 0))
    .map(level => ({ ...level, price: level.price * priceDivisor }));
  if (!levels.length) return null;
  const low = Math.min(...levels.map(level => level.price)), high = Math.max(...levels.map(level => level.price));
  const count = Math.max(1, Math.min(200, Math.round(settings.rows)));
  const rowStep = Math.max((high - low) / count, high * 1e-9);
  const rows = Array.from({ length: count }, (_, index) => ({ low: low + index * rowStep, high: low + (index + 1) * rowStep, up: 0, down: 0, inValueArea: false }));
  for (const level of levels) {
    const row = rows[Math.min(count - 1, Math.max(0, Math.floor((level.price - low) / rowStep)))];
    if (settings.mode === "total") row.up += level.buy + level.sell;
    else { row.up += level.buy; row.down += level.sell; }
  }
  let maxRow = 0, total = 0, poc = 0;
  rows.forEach((row, index) => { const v = row.up + row.down; total += v; if (v > maxRow) { maxRow = v; poc = index; } });
  // Value area: grow from the POC towards the larger neighbouring row until valueArea % is included.
  const target = total * settings.valueArea / 100;
  let included = rows[poc].up + rows[poc].down, lo = poc, hi = poc;
  const volumeOf = index => rows[index].up + rows[index].down;
  while (included < target && (lo > 0 || hi < count - 1)) {
    const up = hi < count - 1 ? volumeOf(hi + 1) : -1, down = lo > 0 ? volumeOf(lo - 1) : -1;
    if (up >= down && hi < count - 1) { hi++; included += up; }
    else if (lo > 0) { lo--; included += down; }
    else break;
  }
  for (let index = lo; index <= hi; index++) rows[index].inValueArea = true;
  return { start: session.time, end: session.time + 86400, low, high, rowStep, rows, total, maxRow,
    poc: low + (poc + 0.5) * rowStep, vah: low + (hi + 1) * rowStep, val: low + lo * rowStep };
}

/** Completed sessions to keep plus the developing (current) one. */
export function buildProfiles(payload, settings = VOLUME_PROFILE_DEFAULTS, priceDivisor = 1, nowSeconds = Date.now() / 1000) {
  const today = Math.floor(nowSeconds / 86400) * 86400;
  const sessions = (payload?.sessions ?? []).filter(session => session.time <= today);
  const completed = sessions.filter(session => session.time < today).slice(-Math.max(1, Math.min(7, settings.sessions)));
  const developing = settings.developing ? sessions.filter(session => session.time === today) : [];
  return [...completed, ...developing].map(session => {
    const profile = buildSessionProfile(session, settings, priceDivisor);
    return profile && { ...profile, developing: session.time === today, end: session.time === today ? Math.min(profile.end, nowSeconds) : profile.end };
  }).filter(Boolean);
}
