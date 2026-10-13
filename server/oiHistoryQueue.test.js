import test from "node:test";
import assert from "node:assert/strict";
import { createOiHistoryQueue } from "./oiHistoryQueue.js";
const settle = () => new Promise(resolve => setImmediate(resolve));
const item = (symbol, exchange = "bybit") => ({ exchange, symbol });

test("all queued coins drain in FIFO order without another browser poll", async () => {
    const fetched = [], stored = [], completed = new Set();
    let inFlight = 0, peak = 0;
    const queue = createOiHistoryQueue({
        supported: () => true, needed: x => !completed.has(x.symbol),
        fetchHistory: async x => {
            fetched.push(x.symbol); peak = Math.max(peak, ++inFlight);
            await settle(); --inFlight; return [{ timestamp: 1, oiCoin: 1 }];
        },
        onPoints: x => { completed.add(x.symbol); stored.push(x.symbol); },
    });
    queue.schedule(["BIG", "MEDIUM", "SMALL", "TINY", "LAST"].map(x => item(x)));
    for (let i = 0; i < 12; ++i) await settle();
    assert.deepEqual(fetched, ["BIG", "MEDIUM", "SMALL", "TINY", "LAST"]);
    assert.equal(stored.length, 5); assert.equal(peak, 2); assert.equal(queue.pendingCount, 0);
});
test("repeated snapshot scheduling deduplicates waiting and active jobs", async () => {
    let finish, calls = 0;
    const queue = createOiHistoryQueue({
        supported: () => true, needed: () => true,
        fetchHistory: () => { ++calls; return new Promise(resolve => { finish = resolve; }); },
        onPoints: () => {},
    });
    for (let i = 0; i < 10; ++i) queue.schedule([item("BTC")]);
    await settle(); assert.equal(calls, 1); finish([{ oiCoin: 1 }]);
    await settle(); queue.schedule([item("BTC")]); await settle();
    assert.equal(calls, 1); assert.equal(queue.pendingCount, 0);
});
test("cooling venue waits while another venue progresses, and resumes when cooldown clears", async () => {
    let cooling = true;
    const fetched = [];
    const queue = createOiHistoryQueue({
        supported: () => true, needed: () => true, isCoolingDown: x => x === "binance" && cooling,
        fetchHistory: async x => { fetched.push(x.exchange); return [{ oiCoin: 1 }]; }, onPoints: () => {},
    });
    queue.schedule([item("BTC", "binance"), item("BTC", "bybit")]); await settle();
    assert.deepEqual(fetched, ["bybit"]); assert.equal(queue.pendingCount, 1);
    cooling = false; queue.schedule([]); await settle();
    assert.deepEqual(fetched, ["bybit", "binance"]);
});
test("failed history retries after five minutes, and does not starve a waiting coin", async () => {
    let now = 1000; const calls = [];
    const queue = createOiHistoryQueue({
        clock: () => now, supported: () => true, needed: () => true, concurrency: 1,
        fetchHistory: async x => { calls.push(x.symbol); if (x.symbol === "FAIL") throw new Error("429"); return [{ oiCoin: 1 }]; },
        onPoints: () => {},
    });
    queue.schedule([item("FAIL"), item("SMALL")]); await settle();
    assert.deepEqual(calls, ["FAIL", "SMALL"]);
    now += 299_999; queue.schedule([item("FAIL")]); await settle(); assert.equal(calls.length, 2);
    now += 1; queue.schedule([item("FAIL")]); await settle(); assert.equal(calls.length, 3);
});
test("unsupported contracts never trigger native history calls", async () => {
    const queue = createOiHistoryQueue({
        supported: () => false, needed: () => true, onPoints: () => {},
        fetchHistory: () => { throw new Error("must not be called"); },
    });
    queue.schedule([item("BTC", "cme")]); await settle(); assert.equal(queue.pendingCount, 0);
});
