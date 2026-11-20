// Super Charts settings that are NOT tied to a coin: which indicators are on,
// their settings, timeframe, volume options and favourite timeframes. Switching
// coins keeps them. Signed in, they are saved to the account (see
// use-chart-settings-sync); signed out, they live in this browser until sign-out
// resets everything to the defaults.
export const CHART_SETTINGS_KEY = 'cof:v1:chart-settings';

function storage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}
function read() {
  try {
    const value = JSON.parse(storage()?.getItem(CHART_SETTINGS_KEY) ?? 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

let state = read();
const listeners = new Set();
const changeListeners = new Set();

function persist() {
  try { storage()?.setItem(CHART_SETTINGS_KEY, JSON.stringify(state)); } catch { /* storage blocked or full */ }
}
function emit() { for (const listener of listeners) listener(); }

export const chartSettingsSnapshot = () => state;
export const getChartSetting = field => state[field];

/** A user change: stored, shown, and reported to the account sync. */
export function setChartSetting(field, value) {
  state = { ...state, [field]: value };
  persist(); emit();
  for (const listener of changeListeners) listener(state);
}

/** Replace everything (settings loaded from the account). Not reported back as a change. */
export function replaceChartSettings(next) {
  state = next && typeof next === 'object' && !Array.isArray(next) ? { ...next } : {};
  persist(); emit();
}

/** Sign-out: back to the defaults. */
export function clearChartSettings() {
  state = {};
  try { storage()?.removeItem(CHART_SETTINGS_KEY); } catch { /* storage blocked */ }
  emit();
}

export function subscribeChartSettings(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function onChartSettingsChange(listener) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}
