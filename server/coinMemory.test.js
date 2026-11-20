import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeCoin, pushRecent, toggleWatch, parseList, readList, writeList, recentKey, WATCHLIST_KEY, RECENT_LIMIT } from "../src/lib/coin-memory.ts";

test("recent coins are most-recent-first, de-duplicated and bounded", () => {
  let list = [];
  for (const coin of ["btc", "ETH", "sol", "BTC"]) list = pushRecent(list, coin);
  assert.deepEqual(list, ["BTC", "SOL", "ETH"]);
  for (let i = 0; i < 20; i++) list = pushRecent(list, `C${i}`);
  assert.equal(list.length, RECENT_LIMIT);
  assert.deepEqual(pushRecent(["BTC"], "  "), ["BTC"]);
  assert.equal(normalizeCoin(" 1000pepe/usdt "), "1000PEPEUSDT");
});

test("watchlist toggles a coin in and out", () => {
  let list = toggleWatch([], "eth");
  assert.deepEqual(list, ["ETH"]);
  list = toggleWatch(list, "BTC");
  assert.deepEqual(list, ["ETH", "BTC"]);
  assert.deepEqual(toggleWatch(list, "eth"), ["BTC"]);
});

test("stored lists are validated and storage failures never throw", () => {
  assert.deepEqual(parseList('["btc","BTC",5,"eth"]', 10), ["BTC", "ETH"]);
  assert.deepEqual(parseList("not json", 10), []);
  assert.deepEqual(parseList('{"a":1}', 10), []);
  const memory = new Map();
  const store = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  writeList(recentKey("funding"), ["BTC"], store);
  assert.deepEqual(readList(recentKey("funding"), 8, store), ["BTC"]);
  assert.notEqual(recentKey("funding"), recentKey("open-interest"), "recent coins are per section");
  assert.ok(WATCHLIST_KEY.includes("watchlist"));
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(readList(WATCHLIST_KEY, 50, broken), []);
  assert.doesNotThrow(() => writeList(WATCHLIST_KEY, ["BTC"], broken));
});

test("every coin section shows recent coins and the personal watchlist", () => {
  for (const [file, section] of [["App.tsx", "lsar-"], ["components/funding-page.tsx", "funding"],
    ["components/open-interest-page.tsx", "open-interest"], ["components/leverage-estimate-page.tsx", "leverage"],
    ["pages/super-charts-page.tsx", "super-charts"]]) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`useCoinMemory\\([^)]*'${section}`), file);
    assert.match(source, /<CoinShortcuts /, file);
    assert.match(source, /<WatchStar /, file);
  }
});
