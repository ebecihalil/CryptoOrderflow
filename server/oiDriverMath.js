// Exchange-fed adaptation of the user-supplied Pine market-driver and spike rules.
export const OI_DRIVER_DEFAULTS = {
  showTotals: true, stateColors: true, showLsar: true,
  flatBodyPct: 15, activityLength: 20, activityFactor: 3,
  pinbarBodyPct: 10, pinbarWickPct: 50, pinbarWickRatio: 2,
  spikeMult: 5, avgLength: 50, maxSidewaysBars: 10, pullback1: 10, pullback2: 20,
  colors: { up: "#3b82f6", down: "#ef4444", longBuild: "#3b82f6", shortBuild: "#f23645",
    limitBuy: "#22c55e", limitSell: "#f97316", shortExit: "#facc15", longExit: "#a855f7", neutral: "#737373" },
};
const bounds = {
  flatBodyPct: [0, 100], activityLength: [1, 300], activityFactor: [1, 100],
  pinbarBodyPct: [0, 100], pinbarWickPct: [0, 100], pinbarWickRatio: [1, 100],
  spikeMult: [0.1, 100], avgLength: [1, 300], maxSidewaysBars: [1, 300],
  pullback1: [0.1, 100], pullback2: [0.1, 100],
};
export function driverSettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid OI indicator settings.");
  const settings = { ...OI_DRIVER_DEFAULTS, colors: { ...OI_DRIVER_DEFAULTS.colors } };
  for (const key of ["showTotals", "stateColors", "showLsar"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error(`Invalid ${key}.`);
    if (value[key] !== undefined) settings[key] = value[key];
  }
  for (const [key, [min, max]] of Object.entries(bounds)) {
    if (value[key] === undefined) continue;
    const n = value[key];
    if (!Number.isFinite(n) || n < min || n > max ||
      (["activityLength", "avgLength", "maxSidewaysBars"].includes(key) && !Number.isInteger(n))) throw new Error(`Invalid ${key}.`);
    settings[key] = n;
  }
  for (const key of Object.keys(settings.colors)) {
    if (value.colors?.[key] === undefined) continue;
    if (!/^#[0-9a-f]{6}$/i.test(value.colors[key])) throw new Error("Invalid indicator color.");
    settings.colors[key] = value.colors[key];
  }
  return settings;
}
const sma = (values, count) => values.length >= count ? values.slice(-count).reduce((a, b) => a + b, 0) / count : null;
export function candleShape(bar, activities, settings) {
  const range = bar.high - bar.low, body = Math.abs(bar.close - bar.open);
  const upper = bar.high - Math.max(bar.close, bar.open), lower = Math.min(bar.close, bar.open) - bar.low;
  const avg = sma(activities, settings.activityLength);
  const flat = range === 0 || body / range * 100 <= settings.flatBodyPct || (avg > 0 && body <= avg / settings.activityFactor);
  const small = range > 0 && body / range * 100 <= settings.pinbarBodyPct;
  return { flat, bullishPinbar: small && lower / range * 100 >= settings.pinbarWickPct && lower >= upper * settings.pinbarWickRatio,
    bearishPinbar: small && upper / range * 100 >= settings.pinbarWickPct && upper >= lower * settings.pinbarWickRatio };
}
export function liquidationSignificant(sideUsd, oiUsd, averageUsd) {
  // Keep the script's positive/relative-activity test; add the user's fixed gate.
  // Equality qualifies: only values strictly BELOW 0.5% are suppressed.
  return Number.isFinite(sideUsd) && oiUsd > 0 && averageUsd !== null &&
    sideUsd / oiUsd >= 0.005 && sideUsd > 0 && sideUsd > averageUsd * 0.2;
}
function classify(oi, price, cvd, flat, hasLong, hasShort, liqKnown, settings) {
  if (!price || !cvd) return { state: "Market Driver unavailable", notePair: null, color: settings.colors.neutral };
  const od = oi.close - oi.open, cd = cvd.close - cvd.open;
  const pu = !flat.price && price.close > price.open, pd = !flat.price && price.close < price.open;
  const cu = cd > 0, cn = cd < 0, fcu = cu && !flat.cvd, fcn = cn && !flat.cvd;
  const ou = od > 0 && !flat.oi, on = od < 0 && !flat.oi;
  const C = settings.colors;
  // Pine's color priority is independent of the displayed flatness label.
  let color = C.neutral;
  if (od > 0 && cu && pu) color = C.longBuild;
  else if (od > 0 && cn && pd) color = C.shortBuild;
  else if (od > 0 && cn && pu) color = C.limitBuy;
  else if (od > 0 && cu && pd) color = C.limitSell;
  else if (flat.price && !flat.oi && !flat.cvd && od !== 0) color = cu ? (od > 0 ? C.limitSell : C.shortExit) : (od > 0 ? C.limitBuy : C.longExit);
  else if (od < 0 && cu && pu) color = C.shortExit;
  else if (od < 0 && cn && pd) color = C.longExit;
  else if (od < 0 && cn && pu) color = C.longExit;
  else if (od < 0 && cu && pd) color = C.shortExit;
  const result = (state, a, b) => ({ state, color, notePair: [a, b] });
  if (flat.oi && flat.cvd) {
    if (pu) return result("Flat OI + CVD Flat: Thin Sell Limit Wall", "Retail Long Accumulation", "Whale Long Accumulation");
    if (pd) return result("Flat OI + CVD Flat: Thin Buy Limit Wall", "Whale Short Accumulation", "Retail Short Accumulation");
    return result("Flat OI + CVD Flat: Balanced Position Rotation", "Retail replaces Whales", "Whale Replaces Retail");
  }
  if (flat.oi) {
    if (fcu && pu) return result("Flat OI: Aggressive Long Rotation", "Whale Dumps(Distribution)", "Whale replace Retail(Accumulation)");
    if (fcn && pd) return result("Flat OI: Aggressive Short Rotation", "Whale replace Retail(Accumulation)", "Whale Dumps(Distribution)");
    if (fcn && (pu || flat.price)) return result("Flat OI: Long Limit Absorption", "Short Retail is Out", "Long Whale Accumulation");
    if (fcu && (pd || flat.price)) return result("Flat OI: Sell Limit Absorption", "Short Whale Accumulation", "Long Retail is Out");
    return result("Flat OI: Mixed Position Rotation", "Retail position rotation", "Whale position rotation");
  }
  if (flat.cvd) {
    if (ou && pu) return result("CVD Flat: Thick Buy Limit Wall", "Retail Long Accumulation", "Whale Long Accumulation");
    if (ou && pd) return result("CVD Flat: Thick Sell Limit Wall", "Whale Short Accumulation", "Retail Short Accumulation");
    if (ou && flat.price) return result("CVD Flat: OI Expansion", "Retail Long vs Whale Short CVD", "Whale Long vs Retail Short");
    if (on && pu) return result("CVD Flat: Thin Sell Limit Wall", "Whale Longs Exit", "Retail Longs Exit");
    if (on && pd) return result("CVD Flat: Thin Buy Limit Wall", "Retail Shorts Exit", "Whale Shorts Exit");
    if (on && flat.price) return result("CVD Flat: OI Reduction", "Short Retail vs Long Whale", "Long Retail vs Short Whale");
    return result("CVD Flat: CVD Flat / Mixed Position Rotation", "Retail CVD Bias", "Whale CVD Bias");
  }
  if (flat.price && od !== 0 && (cu || cn)) {
    if (od > 0 && cu) return result("Limit Sell Absorption", "Retail Longs Trapped", "Fragile Sell Limit Wall");
    if (od > 0 && cn) return result("Limit Buy Absorption", "Fragile Long Limit Wall", "Short Retails Trapped");
    if (od < 0 && cu) return result("Short Exit while absorbed", "Complex dynamics", "Retail Short Exit");
    return result("Long Exit while absorbed", "Complex dynamics", "Retail Long Exit");
  }
  if (od > 0 && cu && pu) return result("Aggressive Longs Openings", "Retail accumulation", "Whale accumulation");
  if (od > 0 && cn && pd) return result("Aggressive Shorts Openings", "Whale Accumulation", "Retail Accumulation");
  if (od > 0 && cn && pu) return result("Limit Buy Absorption (Open)", "Fragile Long Limit Wall", "Short Retails Trapped");
  if (od > 0 && cu && pd) return result("Limit Sell Absorption (Open)", "Long Retails Trapped", "Fragile Sell Limit Wall");
  // Missing liquidation history cannot be used as evidence of a non-liquidation exit.
  if (od < 0 && !liqKnown) return result("Exit classification unavailable: liquidation coverage missing", "", "");
  if (od < 0 && cu && pu) return hasShort
    ? result("Short Liquidation", "Retail Shorts Wiped off", "Retail Longs exit with profit")
    : result("Short Exit", "Retail Shorts exit with Loss", "Retail Longs exit with profit");
  if (od < 0 && cn && pd) return hasLong
    ? result("Long Liquidation", "Retail Longs build the dip", "Long Retails flushed out")
    : result("Long Exit", "Retail Longs trapped", "Retail Longs Exit");
  if (od < 0 && cn && pu) return hasLong
    ? result("Long Liquidation while absorbed", "Complex dynamics", "Retail Long Liquidation")
    : result("Long Exit while absorbed", "Complex dynamics", "Retail Long Exit");
  if (od < 0 && cu && pd) return hasShort
    ? result("Short Liquidation while absorbed", "Complex dynamics", "Retail Short Liquidation")
    : result("Short Exit while absorbed", "Complex dynamics", "Retail Short Exit");
  return result("Neutral / Choppy", "Retail bias", "Whale bias");
}

export function calculateOiDriver(rows, options = {}) {
  const settings = driverSettings(options);
  const oiActivity = [], cvdActivity = [], priceActivity = [], longActivity = [], shortActivity = [];
  let streak = 0, sequence = null, priorCohort = null;
  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], delta = row.close - row.open;
    if (row.segmentStart || (priorCohort !== null && row.cohort !== priorCohort)) {
      streak = 0; sequence = null;
      oiActivity.length = cvdActivity.length = priceActivity.length = longActivity.length = shortActivity.length = 0;
    }
    priorCohort = row.cohort;
    const previousAvg = sma(oiActivity, settings.avgLength);
    oiActivity.push(Math.abs(delta));
    if (row.cvd) cvdActivity.push(Math.abs(row.cvd.close - row.cvd.open)); else cvdActivity.length = 0;
    if (row.price) priceActivity.push(Math.abs(row.price.close - row.price.open)); else priceActivity.length = 0;
    if (Number.isFinite(row.longLiqUsd)) longActivity.push(row.longLiqUsd); else longActivity.length = 0;
    if (Number.isFinite(row.shortLiqUsd)) shortActivity.push(row.shortLiqUsd); else shortActivity.length = 0;
    const flat = { oi: candleShape(row, oiActivity, settings).flat,
      cvd: row.cvd ? candleShape(row.cvd, cvdActivity, settings).flat : false,
      price: row.price ? candleShape(row.price, priceActivity, settings).flat : false };
    const classified = classify(row, row.price, row.cvd, flat,
      liquidationSignificant(row.longLiqUsd, row.oiUsd, sma(longActivity, 20)),
      liquidationSignificant(row.shortLiqUsd, row.oiUsd, sma(shortActivity, 20)),
      Number.isFinite(row.longLiqUsd) && Number.isFinite(row.shortLiqUsd) &&
        longActivity.length >= 20 && shortActivity.length >= 20, settings);
    // Only compare matched contemporaneous account-ratio cohorts on completed bars.
    const direction = row.lsarDirection ?? 0;
    const note = settings.showLsar && direction && classified.notePair
      ? classified.notePair[direction > 0 ? 0 : 1] : "";
    const avg = sma(oiActivity, settings.avgLength);
    streak = delta > 0 ? streak + 1 : 0;
    const alerts = [];
    let spikePct = null, pullbackPct = null, spikeTime = null, spikeHigh = null;
    if (!sequence && ((delta > 0 && (previousAvg ?? avg) !== null && delta >= settings.spikeMult * (previousAvg ?? avg)) || streak === 10)) {
      sequence = { initial: streak === 10 ? rows[i - 9].open : row.open, high: row.high, peakTime: row.time, sideways: 0, fired1: false, fired2: false };
    } else if (sequence) {
      if (row.high > sequence.high) {
        sequence.high = row.high; sequence.peakTime = row.time; sequence.sideways = 0;
        sequence.fired1 = sequence.fired2 = false;
      } else sequence.sideways++;
    }
    if (sequence) {
      spikePct = sequence.initial > 0 ? (sequence.high - sequence.initial) / sequence.initial * 100 : 0;
      spikeTime = sequence.peakTime; spikeHigh = sequence.high;
      pullbackPct = sequence.high > sequence.initial ? (sequence.high - row.close) / (sequence.high - sequence.initial) * 100 : 0;
      if (pullbackPct >= settings.pullback1 && !sequence.fired1) { sequence.fired1 = true; alerts.push(`${settings.pullback1}% Pullback Alert`); }
      if (pullbackPct >= settings.pullback2 && !sequence.fired2) { sequence.fired2 = true; alerts.push(`${settings.pullback2}% Pullback Alert`); }
      // Expire AFTER evaluating alerts, matching the script's sequence ordering.
      if (sequence.sideways >= settings.maxSidewaysBars || row.close < sequence.initial) sequence = null;
    }
    const gross = (row.cvd?.buyValue ?? 0) + (row.cvd?.sellValue ?? 0);
    result.push({ time: row.time, open: row.open, high: row.high, low: row.low, close: row.close,
      color: settings.stateColors ? classified.color : delta >= 0 ? settings.colors.up : settings.colors.down,
      state: classified.state, note, buyPct: gross > 0 ? row.cvd.buyValue / gross * 100 : null,
      sellPct: gross > 0 ? row.cvd.sellValue / gross * 100 : null,
      spikePct, spikeTime, spikeHigh, pullbackPct, alerts, provisional: row.provisional,
      sourceCount: row.sourceCount, liquidationOiPct: Number.isFinite(row.longLiqUsd) && Number.isFinite(row.shortLiqUsd) && row.oiUsd > 0
        ? (row.longLiqUsd + row.shortLiqUsd) / row.oiUsd * 100 : null });
  }
  return result;
}

export function buildOiDriverCandles(contracts, duration, now) {
  const buckets = new Map();
  for (const contract of contracts) {
    for (const point of contract.points) {
      if (!(Number.isFinite(point.timestamp) && point.timestamp <= now && Number.isFinite(point.oiCoin) && point.oiCoin >= 0)) continue;
      const time = Math.floor(point.timestamp / duration) * duration;
      if (!buckets.has(time)) buckets.set(time, new Map());
      const byContract = buckets.get(time);
      if (!byContract.has(contract.key)) byContract.set(contract.key, []);
      byContract.get(contract.key).push(point);
    }
  }
  const output = [];
  let priorCohort = null;
  for (const [time, entries] of [...buckets].sort((a, b) => a[0] - b[0])) {
    const previous = buckets.get(time - duration);
    if (!previous) continue;
    const keys = [...entries.keys()].filter(key => previous.has(key)).sort();
    if (!keys.length) continue;
    const cohort = keys.join("|"), observations = new Map();
    // Aggregate simultaneous/as-of observations, not independently sampled venue maxima.
    const previousPoints = keys.map(key => [key, previous.get(key).sort((a, b) => a.timestamp - b.timestamp).at(-1)]);
    if (previousPoints.some(([, point]) => time - point.timestamp > 300_000)) continue;
    const values = new Map(previousPoints);
    const opening = [...values.values()].reduce((sum, p) => sum + p.oiCoin, 0);
    for (const key of keys) for (const point of entries.get(key)) {
      if (!observations.has(point.timestamp)) observations.set(point.timestamp, []);
      observations.get(point.timestamp).push([key, point]);
    }
    let close = opening, high = opening, low = opening, sampled = false;
    for (const [at, points] of [...observations].sort((a, b) => a[0] - b[0])) {
      for (const [key, point] of points) values.set(key, point);
      // A venue's last observation cannot silently cover long missing intervals.
      if ([...values.values()].some(p => at - p.timestamp > 300_000)) continue;
      close = [...values.values()].reduce((sum, p) => sum + p.oiCoin, 0);
      high = Math.max(high, close); low = Math.min(low, close); sampled = true;
    }
    if (!sampled) continue;
    output.push({ time: time / 1000, open: opening, high, low, close, cohort, sourceCount: keys.length,
      segmentStart: priorCohort !== cohort || output.at(-1)?.time !== (time - duration) / 1000,
      provisional: time + duration > now });
    priorCohort = cohort;
  }
  return output;
}
