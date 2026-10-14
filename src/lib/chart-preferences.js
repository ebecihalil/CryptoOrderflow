// Personal UI preferences only. Background recording remains server-wide.
const PREFIX = 'crypto-orderflow:chart:v1:';
const memory = new Map();
export const LAST_CHART_CONTRACT_KEY = `${PREFIX}last-contract`;

export function validChartContract(value) {
  return !!value && typeof value.asset === 'string' && /^[A-Z0-9]{1,30}$/.test(value.asset) &&
    typeof value.exchange === 'string' && ['binance', 'bybit', 'okx', 'gate', 'mexc', 'bitget', 'bingx'].includes(value.exchange) &&
    typeof value.symbol === 'string' && /^[A-Z0-9_-]{1,60}$/i.test(value.symbol);
}

export function coinPreferenceKey(asset, field) {
  return `${PREFIX}${encodeURIComponent(asset.toUpperCase())}:${field}`;
}

export function chartViewKey(asset, exchange, symbol, timeframe) {
  return coinPreferenceKey(asset, `view:${exchange.toLowerCase()}:${symbol}:${timeframe}`);
}

function storage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function readChartPreference(key, fallback, validate = (value) => validShape(value, fallback)) {
  if (!key) return fallback;
  if (memory.has(key)) {
    const value = memory.get(key);
    return validate(value) ? value : fallback;
  }
  try {
    const raw = storage()?.getItem(key);
    if (raw !== null && raw !== undefined) {
      const value = JSON.parse(raw);
      if (validate(value)) { memory.set(key, value); return value; }
    }
  } catch { /* Invalid or unavailable browser storage does not disable the chart. */ }
  return fallback;
}

export function writeChartPreference(key, value) {
  if (!key) return;
  memory.set(key, value);
  try { storage()?.setItem(key, JSON.stringify(value)); } catch {
    // Keep same-session switching functional if storage is blocked or full.
  }
}

function validShape(value, fallback) {
  if (typeof fallback === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (typeof fallback === 'string' || typeof fallback === 'boolean') return typeof value === typeof fallback;
  if (Array.isArray(fallback)) return Array.isArray(value) && value.every(item => typeof item === 'string');
  if (fallback && typeof fallback === 'object') {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(fallback).every(key => validShape(value[key], fallback[key]));
  }
  return value === fallback;
}

export function validChartView(view) {
  return !!view && Number.isFinite(view.from) && Number.isFinite(view.to) && view.to > view.from &&
    Number.isFinite(view.anchorTime) && Number.isFinite(view.anchorLogical) &&
    !!view.panes && typeof view.panes === 'object' && !Array.isArray(view.panes) &&
    Object.values(view.panes).every(pane =>
      !!pane && Number.isFinite(pane.weight) && pane.weight > 0 &&
      typeof pane.autoScale === 'boolean' &&
      (pane.autoScale || (Number.isFinite(pane.range?.from) && Number.isFinite(pane.range?.to) &&
        pane.range.to > pane.range.from)));
}

// Keep the original time anchor as snapshots move forward; raw indexes alone
// would silently scroll to different candles when the oldest bar drops out.
export function shiftedChartRange(view, newAnchorLogical) {
  const shift = newAnchorLogical - view.anchorLogical;
  return { from: view.from + shift, to: view.to + shift };
}
