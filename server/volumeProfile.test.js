import test from "node:test";
import assert from "node:assert/strict";
import { buildSessionProfile, buildProfiles, VOLUME_PROFILE_DEFAULTS } from "../src/lib/volume-profile.js";

const session = { time: 86400 * 100, levels: [
  { price: 100, buy: 10, sell: 5 }, { price: 101, buy: 50, sell: 40 }, { price: 102, buy: 5, sell: 30 }, { price: 103, buy: 1, sell: 1 },
] };

test("real buy/sell volume per row, POC at the busiest row, 70% value area around it", () => {
  const profile = buildSessionProfile(session, { ...VOLUME_PROFILE_DEFAULTS, rows: 3 });
  assert.equal(profile.rows.length, 3);
  assert.equal(profile.rows[0].up, 10); assert.equal(profile.rows[0].down, 5);
  assert.equal(profile.rows[1].up, 50); assert.equal(profile.rows[1].down, 40);
  assert.equal(profile.rows[2].up, 6); assert.equal(profile.rows[2].down, 31, "top price lands in the last row");
  assert.equal(profile.poc, 100 + 1.5 * 1);
  // 142 total, 70% = 99.4: POC row (90) + the larger neighbour (top row 37).
  assert.deepEqual(profile.rows.map(row => row.inValueArea), [false, true, true]);
  assert.equal(profile.val, 101); assert.equal(profile.vah, 103);
});

test("total mode puts all volume in one colour; contract price divisor scales prices", () => {
  const profile = buildSessionProfile(session, { ...VOLUME_PROFILE_DEFAULTS, rows: 3, mode: "total" }, 1000);
  assert.equal(profile.rows[1].up, 90); assert.equal(profile.rows[1].down, 0);
  assert.equal(profile.low, 100_000);
});

test("keeps the chosen number of completed sessions plus the developing one", () => {
  const day = 86400, today = 200 * day;
  const payload = { sessions: [195, 196, 197, 198, 199, 200].map(d => ({ time: d * day, levels: [{ price: 1, buy: 1, sell: 1 }] })) };
  const profiles = buildProfiles(payload, { ...VOLUME_PROFILE_DEFAULTS, sessions: 2 }, 1, today + 3600);
  assert.deepEqual(profiles.map(p => p.start / day), [198, 199, 200]);
  assert.equal(profiles.at(-1).developing, true);
  assert.equal(profiles.at(-1).end, today + 3600);
});
