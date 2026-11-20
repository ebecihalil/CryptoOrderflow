import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const memory = new Map();
globalThis.localStorage = {
  getItem: key => memory.has(key) ? memory.get(key) : null, setItem: (key, value) => memory.set(key, String(value)),
  removeItem: key => memory.delete(key), key: index => [...memory.keys()][index] ?? null,
  get length() { return memory.size; },
};
const store = await import("../src/lib/chart-settings-store.js");

test("Super Charts settings are one shared set (not per coin), saved and reported as changes", () => {
  const changes = [];
  const off = store.onChartSettingsChange(state => changes.push(state));
  store.setChartSetting("studies", ["ema", "rsi"]);
  store.setChartSetting("indicators", ["aggressive-bubbles"]);
  assert.deepEqual(store.getChartSetting("studies"), ["ema", "rsi"]);
  assert.equal(changes.length, 2);
  assert.deepEqual(JSON.parse(memory.get(store.CHART_SETTINGS_KEY)).indicators, ["aggressive-bubbles"]);
  off();
});

test("loading the account's setup replaces everything without echoing a save; sign-out clears", () => {
  const changes = [];
  const off = store.onChartSettingsChange(state => changes.push(state));
  store.replaceChartSettings({ studies: ["macd"], timeframe: "4h" });
  assert.deepEqual(store.chartSettingsSnapshot(), { studies: ["macd"], timeframe: "4h" });
  assert.equal(changes.length, 0);
  store.clearChartSettings();
  assert.deepEqual(store.chartSettingsSnapshot(), {});
  assert.equal(memory.has(store.CHART_SETTINGS_KEY), false);
  off();
});

test("chart workspace and page use the shared (not per-coin) settings, synced to the account", () => {
  const page = readFileSync(new URL("../src/pages/super-charts-page.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../src/components/native-chart-workspace.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page + workspace, /useCoinChartSetting/);
  assert.match(page, /useChartSetting<ChartStudyId\[\]>\('studies'/);
  assert.match(page, /useChartSettingsSync\(\)/);
  const auth = readFileSync(new URL("../src/hooks/use-auth.ts", import.meta.url), "utf8");
  assert.match(auth, /resetLocalAccountData\(\);/, "sign-out resets this browser to defaults");
});
