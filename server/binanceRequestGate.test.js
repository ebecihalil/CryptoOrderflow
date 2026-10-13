import test from "node:test";
import assert from "node:assert/strict";
import { BinanceRequestGate, BinanceCooldownError } from "./binanceRequestGate.js";
import { sourceFailureLabel } from "../src/lib/source-failure.ts";

const linear = "https://fapi.binance.com/futures/data/globalLongShortAccountRatio";
const inverse = "https://dapi.binance.com/futures/data/globalLongShortAccountRatio";
const oi = "https://fapi.binance.com/fapi/v1/openInterest";
function fixture(options = {}) {
    let time = 1_800_000_000_000;
    const gate = new BinanceRequestGate({
        now: () => time, sleep: async delay => { time += delay; }, ...options,
    });
    return { gate, now: () => time, advance: delay => { time += delay; } };
}
function response(status, headers = {}, body = {}) {
    return new Response(JSON.stringify(body), { status, headers });
}

test("both Binance products share pacing and a rolling futures-data quota", async () => {
    const { gate, now } = fixture({ spacingMs: 0, historyLimit: 2, historyWindowMs: 1000 });
    const start = now();
    await gate.enter(linear);
    await gate.enter(inverse);
    await gate.enter(linear);
    assert.ok(now() - start >= 1000);
    const paced = fixture({ spacingMs: 75 });
    const before = paced.now();
    await Promise.all([paced.gate.enter(linear), paced.gate.enter(oi), paced.gate.enter(inverse)]);
    assert.equal(paced.now() - before, 150);
});

test("general request quota is tracked independently of zero-weight history calls", async () => {
    const { gate, now } = fixture({ spacingMs: 0, generalLimit: 1, generalWindowMs: 1000 });
    const start = now();
    await gate.enter(oi);
    await gate.enter(linear);
    assert.equal(now(), start);
    await gate.enter(oi);
    assert.ok(now() - start >= 1000);
});

test("HTTP 418 blocks both products until Retry-After, then allows recovery", async () => {
    const { gate, advance } = fixture();
    await assert.rejects(gate.inspect(response(418, { "retry-after": "120" })),
        error => error instanceof BinanceCooldownError && error.status === 418);
    await assert.rejects(gate.enter(linear), /HTTP 418/);
    await assert.rejects(gate.enter(inverse), /HTTP 418/);
    advance(120_001);
    await gate.enter(linear);
    assert.equal(gate.isCoolingDown, false);
});

test("HTTP 429 honors date-form Retry-After without extending an existing ban unnecessarily", async () => {
    const { gate, now, advance } = fixture();
    const deadline = now() + 60_000;
    await assert.rejects(gate.inspect(response(429, { "retry-after": new Date(deadline).toUTCString() })), /HTTP 429/);
    assert.equal(gate.blockedUntil, deadline);
    advance(60_001);
    await gate.enter(oi);
});

test("ban deadline in response body is respected and no server IP is exposed", async () => {
    const { gate, now } = fixture();
    const until = now() + 3 * 86_400_000;
    await assert.rejects(gate.inspect(response(418, {}, {
        msg: `IP(192.0.2.1) banned until ${until}.`,
    })), error => error.retryAt === until && !error.message.includes("192.0.2.1"));
    await assert.rejects(gate.inspect(response(429, { "retry-after": "1" })), /HTTP 418/);
    assert.equal(gate.blockedUntil, until);
});

test("missing retry guidance uses conservative cooldowns", async () => {
    for (const [status, duration] of [[418, 900_000], [429, 60_000]]) {
        const { gate, now } = fixture();
        const start = now();
        await assert.rejects(gate.inspect(response(status)), BinanceCooldownError);
        assert.equal(gate.blockedUntil - start, duration);
    }
});

test("high shared-IP request weight pauses admission without inventing an HTTP error", async () => {
    const { gate, now } = fixture();
    const start = now();
    await gate.inspect(response(200, { "x-mbx-used-weight-1m": "1800" }));
    assert.equal(gate.isCoolingDown, false);
    await gate.enter(oi);
    assert.ok(now() - start >= 60_000);
});

test("queued requests recheck a ban before network admission", async () => {
    let time = 1_800_000_000_000;
    let release;
    const gate = new BinanceRequestGate({
        now: () => time,
        sleep: delay => new Promise(resolve => { release = () => { time += delay; resolve(); }; }),
    });
    await gate.enter(linear);
    const queued = gate.enter(inverse);
    const rejection = assert.rejects(queued, /HTTP 418/);
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(gate.inspect(response(418, { "retry-after": "120" })), /HTTP 418/);
    release();
    await rejection;
});

test("compact status labels distinguish IP bans, throttling and access restrictions", () => {
    assert.equal(sourceFailureLabel("Exchange returned HTTP 418"), "IP blocked");
    assert.equal(sourceFailureLabel("Binance HTTP 429: rate limited"), "rate limited");
    assert.equal(sourceFailureLabel("Exchange returned HTTP 451"), "access restricted");
    assert.equal(sourceFailureLabel("Missing history"), null);
    assert.equal(sourceFailureLabel(null), null);
});

test("a slow error body cannot allow requests before the advertised cooldown", async () => {
    const { gate, advance } = fixture();
    let finishBody;
    const body = new Promise(resolve => { finishBody = resolve; });
    const pending = gate.inspect({
        status: 418, headers: new Headers({ "retry-after": "120" }),
        clone: () => ({ json: () => body }),
    });
    const rejection = assert.rejects(pending, /HTTP 418/);
    advance(2000);
    await assert.rejects(gate.enter(linear), /HTTP 418/);
    finishBody({});
    await rejection;
});
