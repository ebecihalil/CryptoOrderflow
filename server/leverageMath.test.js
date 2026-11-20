import test from "node:test";
import assert from "node:assert/strict";
import { calculateLeverage, classifyBuild, mergeVenueBars, weightedShare, percentileRank, leverageRegime, sideLabel } from "./leverageMath.js";

const H = 3_600_000;
const bars = (count, make) => Array.from({ length: count }, (_, i) => ({ time: i * H, ...make(i) }));

test("OI change is classified by aggressor flow, and weak flow is not attributed", () => {
  assert.deepEqual(classifyBuild(100, 12), { state: "long-build", longUsd: 100, shortUsd: 0 });
  assert.deepEqual(classifyBuild(100, -12), { state: "short-build", longUsd: 0, shortUsd: 100 });
  assert.deepEqual(classifyBuild(-100, -12), { state: "long-unwind", longUsd: -100, shortUsd: 0 });
  assert.deepEqual(classifyBuild(-100, 12), { state: "short-unwind", longUsd: 0, shortUsd: -100 });
  assert.equal(classifyBuild(100, 2).state, "neutral");
  assert.equal(classifyBuild(null, 20).state, "neutral");
});

test("top-trader ratios are aggregated as OI-weighted shares, not averaged ratios", () => {
  // ratio 3 => 75% long, ratio 1 => 50% long; OI weights 1:3
  assert.equal(weightedShare([{ ratio: 3, weight: 1 }, { ratio: 1, weight: 3 }]), (0.75 + 1.5) / 4);
  assert.equal(weightedShare([{ ratio: 0, weight: 1 }]), null);
});

test("a venue joining late does not create a false pressure jump", () => {
  const binance = bars(300, () => ({ oiUsd: 1000, spotTurnoverUsd: 100 }));
  // Gate starts at bar 200 with a very different OI/spot ratio (OI 5000 vs spot 10).
  const gate = bars(300, () => ({ oiUsd: 5000, spotTurnoverUsd: 10 })).slice(200);
  const rows = calculateLeverage(mergeVenueBars({ binance, gate }), { lookback: 100, volLen: 5 });
  for (const row of rows.slice(50)) assert.ok(Math.abs(row.pressureIndex - 100) < 1e-9, `bar ${row.time / H}: ${row.pressureIndex}`);
  // Gate contributes only after it has its own baseline history.
  assert.deepEqual(rows[210].matchedSources, ["binance"]);
  assert.deepEqual(rows[260].matchedSources, ["binance", "gate"]);
});

test("rising OI vs flat spot turnover raises pressure above its median", () => {
  const binance = bars(260, i => ({ oiUsd: i < 240 ? 1000 : 2000, spotTurnoverUsd: 100 }));
  const rows = calculateLeverage(mergeVenueBars({ binance }), { lookback: 200, volLen: 5 });
  assert.ok(rows.at(-1).pressureIndex > 190);
});

test("leveraged long build, top-trader size skew and score combine into a long-heavy reading", () => {
  const binance = bars(260, i => {
    const late = i >= 230;
    return {
      oiUsd: late ? 1000 + (i - 229) * 40 : 1000 + Math.sin(i) * 5,
      spotTurnoverUsd: 100,
      takerBuyUsd: late ? 70 : 50 + Math.cos(i) * 2, takerSellUsd: late ? 30 : 50,
      // Late: equal account split but longs hold more size => positive size skew.
      topAccountRatio: 1, topPositionRatio: late ? 2 : 1 + Math.sin(i) * 0.05,
      globalAccountRatio: late ? 2.5 : 1.2,
    };
  });
  const rows = calculateLeverage(mergeVenueBars({ binance }), { lookback: 200, volLen: 5, buildWindow: 24 });
  const last = rows.at(-1);
  assert.equal(last.buildState, "long-build");
  assert.ok(last.netLongBuildUsd > 0 && last.netShortBuildUsd === 0);
  assert.ok(last.sizeSkew > 0.6);
  assert.ok(last.retailDivergencePct > 0, "retail more long than top-trader position share");
  assert.ok(last.leverageScore >= 80, `score ${last.leverageScore}`);
  assert.equal(leverageRegime(last.leverageScore), "extreme");
  assert.equal(sideLabel(last.sideBias), "long-heavy");
});

test("missing inputs stay unavailable instead of becoming zero", () => {
  const rows = calculateLeverage(mergeVenueBars({ binance: bars(5, () => ({ oiUsd: 1000 })) }));
  assert.ok(rows.every(row => row.pressureIndex === null && row.leverageScore === null && row.imbalancePct === null));
  assert.equal(percentileRank([1, 2, 3], 2), null);
  assert.equal(leverageRegime(null), "unavailable");
});
