import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
test("autocomplete is keyboard accessible and limits local suggestions without per-keystroke fetches", () => {
  const source = read("components/market-autocomplete.tsx");
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) assert.ok(source.includes(key));
  assert.match(source, /role="combobox"/); assert.match(source, /role="listbox"/);
  assert.match(source, /aria-activedescendant/); assert.match(source, /\.slice\(0, 8\)/);
  assert.match(source, /detailHead === term/);
  assert.doesNotMatch(source, /fetch\(/);
});
test("LSAR and Funding search suggestions derive from existing snapshots", () => {
  for (const path of ["App.tsx", "components/funding-page.tsx"]) {
    const source = read(path);
    assert.match(source, /<MarketAutocomplete/);
    assert.match(source, /options=\{/);
    assert.match(source, /setSearch/);
  }
});
test("verified shared market drives a native chart and synchronized orderflow layers", () => {
  const page = read("pages/super-charts-page.tsx");
  assert.match(page, /market\.symbol/);
  assert.match(page, /market\?\.asset/);
  assert.match(page, /contract=\{market\}/);
  const workspace = read("components/native-chart-workspace.tsx");
  assert.match(workspace, /useLiquidityCandles/);
  assert.match(workspace, /useFundingIndicator/);
  assert.match(workspace, /payload\.timeframe === props\.timeframe/);
  assert.match(workspace, /normalizeFundingAsset/);
  assert.match(read("hooks/use-market-contracts.ts"), /let inFlight/);
});
