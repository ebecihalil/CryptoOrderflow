// This source code is subject to the Mozilla Public License 2.0.
// https://mozilla.org/MPL/2.0/
// ©ebecihalil — JavaScript adaptation of the supplied Pine v6 Liquidity Zones.

export type Candle = {
  time: number; open: number; high: number; low: number;
  close: number; volume: number; closed: boolean;
};
export type LiquiditySettings = { backBars: number; volMult: number };
export type LiquidityZone = {
  id: number; top: number; bottom: number; leftTime: number;
  createdTime: number; count: number; side: number;
  status: 'support' | 'resistance' | 'inside';
};
export type LiquiditySignal = {
  time: number; type: 'breakout' | 'touch'; zoneIds: number[]; closed: boolean;
};

/** Pine ta.atr: true range with first high-low, then SMA-seeded Wilder RMA. */
export function wilderAtr(candles: Candle[], length = 14): Array<number | null> {
  let seed = 0, average: number | null = null;
  return candles.map((bar, i) => {
    const previousClose = candles[i - 1]?.close;
    const tr = previousClose === undefined ? bar.high - bar.low
      : Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
    if (i < length) seed += tr;
    if (i === length - 1) average = seed / length;
    else if (average !== null) average = (average * (length - 1) + tr) / length;
    return average;
  });
}

/** Latest equal extreme wins: allow ties to the left, not to the right. */
export function confirmedPivot(candles: Candle[], confirmationIndex: number, high: boolean): number | null {
  const strength = 10, pivotIndex = confirmationIndex - strength;
  if (pivotIndex < strength) return null;
  const price = high ? candles[pivotIndex].high : candles[pivotIndex].low;
  for (let j = pivotIndex - strength; j <= confirmationIndex; j++) {
    if (j === pivotIndex) continue;
    const value = high ? candles[j].high : candles[j].low;
    if (high ? value > price || (j > pivotIndex && value === price)
      : value < price || (j > pivotIndex && value === price)) return null;
  }
  return price;
}

export function calculateLiquidityZones(candles: Candle[], settings: LiquiditySettings) {
  if (!Number.isInteger(settings.backBars) || settings.backBars < 50 || settings.backBars > 900 ||
    !Number.isFinite(settings.volMult) || settings.volMult < 0.1) {
    throw new Error('Bars must be 50–900 and sensitivity must be at least 0.1.');
  }
  const atr = wilderAtr(candles);
  let volumeSum = 0;
  const volumeSma = candles.map((bar, i) => {
    volumeSum += bar.volume;
    if (i >= 20) volumeSum -= candles[i - 20].volume;
    return i >= 19 ? volumeSum / 20 : null;
  });
  const candidates: Array<LiquidityZone & { visible: boolean }> = [];
  const signals: LiquiditySignal[] = [];
  const startIndex = candles.length - 1 - settings.backBars;
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i], pivotIndex = i - 10;
    if (i >= startIndex && pivotIndex >= 0 && volumeSma[pivotIndex] !== null &&
      candles[pivotIndex].volume > volumeSma[pivotIndex]! * settings.volMult && atr[i] !== null) {
      // The Pine processes a confirmed high first, then the low on the same bar.
      for (const high of [true, false]) {
        const price = confirmedPivot(candles, i, high);
        if (price === null) continue;
        const match = candidates.find(zone =>
          Math.max(zone.top, price) - Math.min(zone.bottom, price) <= atr[i]!);
        if (match) {
          match.count++;
          match.top = Math.max(match.top, price);
          match.bottom = Math.min(match.bottom, price);
          if (!match.visible) {
            match.visible = true;
            match.createdTime = bar.time;
            match.side = bar.close > match.top ? 1 : bar.close < match.bottom ? -1 : 0;
          }
        } else {
          candidates.push({
            id: candidates.length, top: price, bottom: price,
            leftTime: candles[pivotIndex].time, createdTime: 0,
            count: 1, side: 0, status: 'inside', visible: false,
          });
        }
      }
    }
    const breaks: number[] = [], touches: number[] = [];
    for (const zone of candidates) {
      if (!zone.visible) continue;
      if (bar.close > zone.top) {
        if (zone.side === -1) breaks.push(zone.id);
        zone.side = 1;
        zone.status = 'support';
      } else if (bar.close < zone.bottom) {
        if (zone.side === 1) breaks.push(zone.id);
        zone.side = -1;
        zone.status = 'resistance';
      } else {
        // Inside does not reset entry-side memory, including exact boundaries.
        zone.status = 'inside';
      }
      // Keep the source's endpoint-in-zone rule, not generic wick overlap.
      if ((bar.high >= zone.bottom && bar.high <= zone.top) ||
        (bar.low <= zone.top && bar.low >= zone.bottom)) touches.push(zone.id);
    }
    if (breaks.length) signals.push({ time: bar.time, type: 'breakout', zoneIds: breaks, closed: bar.closed });
    if (touches.length) signals.push({ time: bar.time, type: 'touch', zoneIds: touches, closed: bar.closed });
  }
  const zones: LiquidityZone[] = candidates.filter(zone => zone.visible).slice(-500)
    .map(({ visible: _visible, ...zone }) => zone);
  return { zones, signals };
}
