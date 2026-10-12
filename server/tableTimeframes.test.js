import test from "node:test";
import assert from "node:assert/strict";
import { TIMEFRAMES, orderedTimeframes } from "../src/lib/table-timeframes.ts";

test("every selected TF is first, with all other TFs retained in their usual order", () => {
    for (const selected of TIMEFRAMES) {
        const ordered = orderedTimeframes(selected);
        assert.equal(ordered[0], selected);
        assert.deepEqual(ordered.slice(1), TIMEFRAMES.filter((timeframe) => timeframe !== selected));
        assert.equal(ordered.length, 6);
        assert.equal(new Set(ordered).size, 6);
    }
});

test("changing selections recomputes the order without changing the original TF list", () => {
    assert.deepEqual(orderedTimeframes("4h"), ["4h", "5m", "15m", "30m", "1h", "24h"]);
    assert.deepEqual(orderedTimeframes("5m"), ["5m", "15m", "30m", "1h", "4h", "24h"]);
    assert.deepEqual(orderedTimeframes("1h"), ["1h", "5m", "15m", "30m", "4h", "24h"]);
    assert.deepEqual(TIMEFRAMES, ["5m", "15m", "30m", "1h", "4h", "24h"]);
});
