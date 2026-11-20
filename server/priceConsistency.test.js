import test from "node:test";
import assert from "node:assert/strict";
import { createPriceConsistency } from "./priceConsistency.js";

const t = (exchange, price, time = 1_000_000) => ({ exchange, price, time });

test("a trade far from the other exchanges' price (different token / stale venue) is rejected", () => {
  const guard = createPriceConsistency();
  assert.ok(guard.accept("KERNEL", "perpetual", t("binance", 0.050)));
  assert.ok(guard.accept("KERNEL", "perpetual", t("bybit", 0.0502)));
  assert.ok(guard.accept("KERNEL", "spot", t("okx", 0.0499)));
  assert.equal(guard.accept("KERNEL", "spot", t("mexc", 0.031)), false, "38% away");
  assert.ok(guard.accept("KERNEL", "perpetual", t("gate", 0.0505)), "1% away is fine");
  assert.deepEqual(guard.rejectedFor("KERNEL"), { mexc: 1 });
});

test("too few other exchanges or stale references: trades are kept", () => {
  const guard = createPriceConsistency();
  assert.ok(guard.accept("X", "perpetual", t("binance", 100)));
  assert.ok(guard.accept("X", "perpetual", t("bybit", 50)), "only one reference");
  assert.ok(guard.accept("Y", "perpetual", t("a", 100, 0)));
  assert.ok(guard.accept("Y", "perpetual", t("b", 100, 0)));
  assert.ok(guard.accept("Y", "perpetual", t("c", 60, 500_000)), "references older than 2 minutes are ignored");
});
