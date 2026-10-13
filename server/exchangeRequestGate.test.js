import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExchangeRequestGate, ExchangeCooldownError, EXCHANGE_POLICIES } from "./exchangeRequestGate.js";
import { BinanceRequestGate } from "./binanceRequestGate.js";
import { createExchangeHttpClient } from "./exchangeHttpClient.js";
import { RequestStateStore } from "./requestStateStore.js";
import { createRequestGates } from "./requestGates.js";

const urls = {
    bybit: "https://api.bybit.com/v5/market/account-ratio",
    okx: "https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio-contract",
    gate: "https://api.gateio.ws/api/v4/futures/usdt/contract_stats",
    bitget: "https://api.bitget.com/api/v2/mix/market/account-long-short",
    toobit: "https://api.toobit.com/quote/v1/globalLongShortAccountRatio",
};
const response = (status = 200, headers = {}, body = {}) => new Response(JSON.stringify(body), { status, headers });
function fixture(exchange, options = {}) {
    let time = 1_800_000_000_000;
    const clock = { now: () => time, sleep: async delay => { time += delay; } };
    const gate = new ExchangeRequestGate(exchange, { ...clock, ...options });
    return { gate, ...clock, advance: delay => { time += delay; } };
}

for (const exchange of Object.keys(EXCHANGE_POLICIES)) {
    test(`${exchange} concurrent symbols/timeframes remain within every rolling quota`, async () => {
        const f = fixture(exchange);
        const starts = [];
        // Admission timestamps are recorded before releasing the FIFO queue.
        const save = f.gate.save;
        f.gate.save = state => { starts.push(f.now()); save(state); };
        const allRule = EXCHANGE_POLICIES[exchange].rules[0];
        await Promise.all(Array.from({ length: allRule.limit + 8 }, (_, index) =>
            f.gate.enter(`${urls[exchange]}?symbol=COIN${index}&period=${index % 2 ? "5m" : "1h"}`)));
        for (let i = 1; i < starts.length; i++)
            assert.ok(starts[i] - starts[i - 1] >= EXCHANGE_POLICIES[exchange].spacingMs);
        for (const policy of EXCHANGE_POLICIES[exchange].rules)
            for (const end of starts)
                assert.ok(starts.filter(time => time > end - policy.windowMs && time <= end).length <= policy.limit);
    });

    test(`${exchange} one HTTP 429 stops queued calls and does not immediately retry`, async () => {
        const f = fixture(exchange);
        let calls = 0;
        const client = createExchangeHttpClient({
            gates: { [exchange]: f.gate }, sleep: f.sleep,
            fetchImpl: async () => { calls++; return response(429, { "retry-after": "120" }); },
        });
        await assert.rejects(client(urls[exchange]), ExchangeCooldownError);
        await Promise.all(Array.from({ length: 12 }, () =>
            assert.rejects(client(urls[exchange]), ExchangeCooldownError)));
        assert.equal(calls, 1);
        assert.equal(f.gate.blockedUntil, f.now() + 121_000);
        f.advance(121_000);
        const recovered = createExchangeHttpClient({
            gates: { [exchange]: f.gate }, fetchImpl: async () => { calls++; return response(200, {}, { data: [] }); },
        });
        assert.deepEqual(await recovered(urls[exchange]), { data: [] });
        assert.equal(calls, 2);
    });
}

for (const [exchange, body] of [
    ["bybit", { retCode: 10006, retMsg: "Too many visits!" }],
    ["okx", { code: "50011", msg: "Rate limit reached" }],
    ["bitget", { code: "429", msg: "Too many requests" }],
    ["toobit", { code: -1003, msg: "Too many requests" }],
    ["gate", { label: "TOO_MANY_REQUESTS", message: "Too many requests" }],
]) {
    test(`${exchange} HTTP 200 rate-limit body pauses the entire provider`, async () => {
        const f = fixture(exchange);
        let calls = 0;
        const client = createExchangeHttpClient({
            gates: { [exchange]: f.gate },
            fetchImpl: async () => { calls++; return response(200, {}, body); },
        });
        await assert.rejects(client(urls[exchange]), ExchangeCooldownError);
        await assert.rejects(client(urls[exchange]), ExchangeCooldownError);
        assert.equal(calls, 1);
        assert.ok(f.gate.isCoolingDown);
    });
}

test("Bitget metadata does not bypass or reset the shared ratio quota", async () => {
    const f = fixture("bitget");
    const start = f.now();
    await f.gate.enter(urls.bitget + "?symbol=BTCUSDT&period=5m");
    await f.gate.enter("https://api.bitget.com/api/v2/mix/market/tickers");
    await f.gate.enter(urls.bitget + "?symbol=ETHUSDT&period=1h");
    assert.ok(f.now() - start >= 1251);
});

test("Bybit HTTP 403 / JSON IP ban observes at least ten minutes even with short retry guidance", async () => {
    const f = fixture("bybit");
    const start = f.now();
    assert.throws(() => f.gate.inspect(response(403, { "retry-after": "1" })), ExchangeCooldownError);
    assert.ok(f.gate.blockedUntil >= start + 15 * 60_000);
    const second = fixture("bybit");
    assert.throws(() => second.gate.inspectBody({ retCode: 10009, retMsg: "IP banned" }, response()), ExchangeCooldownError);
    assert.ok(second.gate.blockedUntil >= second.now() + 15 * 60_000);
});

test("date Retry-After and Toobit reset timestamps are honored", () => {
    const f = fixture("toobit");
    const deadline = f.now() + 180_000;
    assert.throws(() => f.gate.inspect(response(429, {
        "retry-after": new Date(f.now() + 60_000).toUTCString(),
        "x-api-limit-reset-timestamp": String(deadline),
    })), ExchangeCooldownError);
    assert.equal(f.gate.blockedUntil, deadline + 1000);
});

test("near-exhausted quota headers delay admission; missing headers do not invent usage", async () => {
    for (const [exchange, remaining, limit, reset] of [
        ["bybit", "x-bapi-limit-status", "x-bapi-limit", "x-bapi-limit-reset-timestamp"],
        ["toobit", "x-api-limit-status", "x-api-limit", "x-api-limit-reset-timestamp"],
        ["gate", "x-gate-ratelimit-requests-remain", "x-gate-ratelimit-limit", "x-gate-ratelimit-reset-timestamp"],
    ]) {
        const f = fixture(exchange);
        f.gate.inspect(response());
        assert.equal(f.gate.nextStart, 0);
        const deadline = f.now() + 10_000;
        f.gate.inspect(response(200, { [remaining]: "1", [limit]: "100", [reset]: String(deadline) }));
        await f.gate.enter(urls[exchange]);
        assert.ok(f.now() >= deadline + 1000);
        assert.equal(f.gate.isCoolingDown, false);
    }
});

test("fallback wait grows after repeated throttles without retry guidance", () => {
    const f = fixture("okx");
    assert.throws(() => f.gate.inspect(response(429)), ExchangeCooldownError);
    assert.equal(f.gate.blockedUntil - f.now(), 60_000);
    f.advance(60_000);
    assert.throws(() => f.gate.inspect(response(429)), ExchangeCooldownError);
    assert.equal(f.gate.blockedUntil - f.now(), 120_000);
});

test("an exchange cooldown never stops another provider", async () => {
    const bybit = fixture("bybit"), okx = fixture("okx");
    const client = createExchangeHttpClient({
        gates: { bybit: bybit.gate, okx: okx.gate },
        fetchImpl: async url => response(url.includes("bybit") ? 429 : 200, {}, { code: "0", data: [] }),
    });
    await assert.rejects(client(urls.bybit), ExchangeCooldownError);
    assert.deepEqual(await client(urls.okx), { code: "0", data: [] });
});

test("queued sleepers recheck a provider-wide pause before starting network calls", async () => {
    let release;
    const sleeping = new Promise(resolve => { release = resolve; });
    const f = fixture("okx", { sleep: () => sleeping });
    await f.gate.enter(urls.okx);
    const queued = f.gate.enter(urls.okx);
    await Promise.resolve();
    assert.throws(() => f.gate.inspect(response(429)), ExchangeCooldownError);
    release();
    await assert.rejects(queued, ExchangeCooldownError);
});

test("HTTP rate errors pause admission before a slow error body is parsed", async () => {
    const f = fixture("gate");
    const res = { status: 429, ok: false, headers: new Headers(), json: () => new Promise(() => {}) };
    assert.throws(() => f.gate.inspect(res), ExchangeCooldownError);
    await assert.rejects(f.gate.enter(urls.gate), ExchangeCooldownError);
});

test("all six request gates are registered, with shared Binance products and no unguarded hosts", async () => {
    const memory = new Map();
    const gates = createRequestGates({ store: { read: key => memory.get(key), save: (key, state) => memory.set(key, state) } });
    assert.deepEqual(Object.keys(gates).sort(), ["binance", "bitget", "bybit", "gate", "okx", "toobit"]);
    assert.equal(gates.binance.historyLimit, 800);
    const client = createExchangeHttpClient({ gates, fetchImpl: () => { throw Error("Should not fetch"); } });
    await assert.rejects(client("https://unknown.example/market"), /No request limiter/);
});

test("transient HTTP 503 retries are accounted for and permanent HTTP errors are not retried", async () => {
    const f = fixture("bybit");
    let calls = 0;
    const client = createExchangeHttpClient({
        gates: { bybit: f.gate }, sleep: f.sleep,
        fetchImpl: async () => response(++calls === 1 ? 503 : 200, {}, { retCode: 0, result: {} }),
    });
    await client(urls.bybit);
    assert.equal(calls, 2);
    assert.equal(f.gate.buckets.all.length, 2);
    calls = 0;
    const permanent = createExchangeHttpClient({
        gates: { bybit: f.gate }, sleep: f.sleep,
        fetchImpl: async () => { calls++; return response(404); },
    });
    await assert.rejects(permanent(urls.bybit), /HTTP 404/);
    assert.equal(calls, 1);
});

test("saved cooldowns and request windows survive limiter/process reconstruction", async () => {
    const directory = mkdtempSync(join(tmpdir(), "lsar-limiter-"));
    try {
        const file = join(directory, "request-state.json");
        const store = new RequestStateStore(file);
        const f = fixture("toobit", { save: state => store.save("toobit", state) });
        await f.gate.enter(urls.toobit);
        assert.throws(() => f.gate.inspect(response(429, { "retry-after": "120" })), ExchangeCooldownError);
        const reloaded = new RequestStateStore(file);
        const resumed = new ExchangeRequestGate("toobit", { now: f.now, sleep: f.sleep, state: reloaded.read("toobit") });
        assert.equal(resumed.blockedUntil, f.gate.blockedUntil);
        assert.deepEqual(resumed.buckets, f.gate.buckets);
        await assert.rejects(resumed.enter(urls.toobit), ExchangeCooldownError);
        f.advance(121_000);
        await resumed.enter(urls.toobit);
        assert.equal(resumed.buckets.all.length, 1);

        const clock = { now: f.now, sleep: f.sleep };
        const binance = new BinanceRequestGate({ ...clock, historyLimit: 2, historyWindowMs: 1000,
            save: state => store.save("binance", state) });
        const url = "https://fapi.binance.com/futures/data/globalLongShortAccountRatio";
        await binance.enter(url);
        await binance.enter(url);
        const before = f.now();
        const binanceReloaded = new BinanceRequestGate({ ...clock, historyLimit: 2, historyWindowMs: 1000,
            state: new RequestStateStore(file).read("binance") });
        await binanceReloaded.enter(url);
        assert.ok(f.now() - before >= 900);
        await assert.rejects(binance.inspect(response(418, {}, { msg: `IP banned until ${f.now() + 180_000}` })), /HTTP 418/);
        const banned = new BinanceRequestGate({ ...clock, state: new RequestStateStore(file).read("binance") });
        await assert.rejects(banned.enter(url), /HTTP 418/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("invalid limiter state fails closed and storage errors prevent outbound requests", async () => {
    const directory = mkdtempSync(join(tmpdir(), "lsar-invalid-state-"));
    try {
        const file = join(directory, "state.json");
        writeFileSync(file, "{broken");
        assert.throws(() => new RequestStateStore(file), /Cannot safely load/);
        assert.throws(() => new ExchangeRequestGate("okx", { state: { blockedUntil: "bad" } }), /Invalid/);
        const f = fixture("bybit", { save: () => { throw new Error("Disk unavailable"); } });
        let calls = 0;
        const client = createExchangeHttpClient({
            gates: { bybit: f.gate }, fetchImpl: async () => { calls++; return response(); },
        });
        await assert.rejects(client(urls.bybit), /Disk unavailable/);
        assert.equal(calls, 0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Binance general quota counts bulk ticker weights, not just request count", async () => {
    let time = 1_800_000_000_000;
    const gate = new BinanceRequestGate({
        now: () => time, sleep: async delay => { time += delay; }, spacingMs: 0, generalLimit: 100,
    });
    const start = time;
    await gate.enter("https://fapi.binance.com/fapi/v1/ticker/24hr");
    await gate.enter("https://dapi.binance.com/dapi/v1/ticker/price");
    await gate.enter("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT");
    assert.ok(time - start >= 60_000);
});
