/** Exchange-candle technical studies. No remote data, lookahead or zero-filled warmup. */
export const DEFAULT_TECHNICAL_SETTINGS = Object.freeze({
  emaPeriod: 20,
  smaPeriod: 20,
  bbPeriod: 20,
  bbStdDev: 2,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
});

export function validateTechnicalSettings(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Technical settings must be an object.");
  }
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULT_TECHNICAL_SETTINGS, key)) throw new RangeError(`Unknown technical setting: ${key}`);
  }
  const settings = { ...DEFAULT_TECHNICAL_SETTINGS, ...input };
  for (const [key, value] of Object.entries(settings)) {
    if (key === "bbStdDev") {
      if (!Number.isFinite(value) || value <= 0 || value > 10) {
        throw new RangeError("Bollinger deviation must be greater than 0 and at most 10.");
      }
    } else if (!Number.isInteger(value) || value < 2 || value > 500) {
      throw new RangeError(`${key} must be an integer from 2 to 500.`);
    }
  }
  if (settings.macdFast >= settings.macdSlow) {
    throw new RangeError("MACD fast period must be smaller than its slow period.");
  }
  return settings;
}

function validateCandles(candles) {
  if (!Array.isArray(candles)) throw new TypeError("Candles must be an array.");
  let previous = -Infinity;
  for (const candle of candles) {
    if (!candle || !Number.isInteger(candle.time) || candle.time < 0 ||
        !Number.isFinite(candle.close) || candle.close < 0) {
      throw new TypeError("Each candle needs an integer UTC timestamp and a finite non-negative close.");
    }
    if (candle.time <= previous) throw new RangeError("Candles must have unique, ascending timestamps.");
    previous = candle.time;
  }
}

function sma(points, period) {
  const result = [];
  for (let index = period - 1; index < points.length; index++) {
    // Two-pass local calculations avoid variance cancellation for high-priced coins.
    let sum = 0;
    for (let offset = index - period + 1; offset <= index; offset++) sum += points[offset].value;
    result.push({ time: points[index].time, value: sum / period });
  }
  return result;
}

function ema(points, period) {
  if (points.length < period) return [];
  let value = 0;
  for (let index = 0; index < period; index++) value += points[index].value;
  value /= period;
  const result = [{ time: points[period - 1].time, value }];
  const alpha = 2 / (period + 1);
  for (let index = period; index < points.length; index++) {
    value += alpha * (points[index].value - value);
    result.push({ time: points[index].time, value });
  }
  return result;
}

function rsi(points, period) {
  if (points.length <= period) return [];
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index++) {
    const delta = points[index].value - points[index - 1].value;
    gain += Math.max(delta, 0);
    loss += Math.max(-delta, 0);
  }
  gain /= period;
  loss /= period;
  const value = () => loss === 0 ? (gain === 0 ? 50 : 100) : gain === 0 ? 0 : 100 - 100 / (1 + gain / loss);
  const result = [{ time: points[period].time, value: value() }];
  for (let index = period + 1; index < points.length; index++) {
    const delta = points[index].value - points[index - 1].value;
    gain = (gain * (period - 1) + Math.max(delta, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-delta, 0)) / period;
    result.push({ time: points[index].time, value: value() });
  }
  return result;
}

function bollinger(points, period, deviation) {
  const middle = sma(points, period);
  const upper = [];
  const lower = [];
  for (let index = 0; index < middle.length; index++) {
    const mean = middle[index].value;
    let squareSum = 0;
    for (let offset = index; offset < index + period; offset++) {
      squareSum += (points[offset].value - mean) ** 2;
    }
    const width = deviation * Math.sqrt(squareSum / period);
    upper.push({ time: middle[index].time, value: mean + width });
    lower.push({ time: middle[index].time, value: mean - width });
  }
  return { middle, upper, lower };
}

function macd(points, settings) {
  const fast = new Map(ema(points, settings.macdFast).map(point => [point.time, point.value]));
  const line = ema(points, settings.macdSlow).map(point => ({
    time: point.time, value: fast.get(point.time) - point.value,
  }));
  const signal = ema(line, settings.macdSignal);
  const values = new Map(line.map(point => [point.time, point.value]));
  const histogram = signal.map(point => ({ time: point.time, value: values.get(point.time) - point.value }));
  return { macd: line, signal, histogram };
}

export function calculateTechnicalIndicators(candles, input = {}) {
  const settings = validateTechnicalSettings(input);
  validateCandles(candles);
  const points = candles.map(candle => ({ time: candle.time, value: candle.close }));
  return {
    ema: ema(points, settings.emaPeriod),
    sma: sma(points, settings.smaPeriod),
    bb: bollinger(points, settings.bbPeriod, settings.bbStdDev),
    rsi: rsi(points, settings.rsiPeriod),
    macd: macd(points, settings),
  };
}
