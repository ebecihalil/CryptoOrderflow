import test from "node:test";
import assert from "node:assert/strict";
import { BinanceRequestGate } from "./binanceRequestGate.js";
import { createRequestGates } from "./requestGates.js";
import { createExchangeHttpClient } from "./exchangeHttpClient.js";
import { createGeoBlockRegistry } from "./binanceAccess.js";

// A fake clock + fake Binance, driving the REAL production gate settings.
function harness(binanceReply) {
  let time = 1_800_000_000_000;
  const memory = new Map();
  const store = { read: key => memory.get(key), save: (key, value) => memory.set(key, structuredClone(value)) };
  const gates = createRequestGates({ store });
  const gate = gates.binance;
  gate.now = () => time;
  gate.sleep = async delay => { time += delay; };
  const sent = [];
  const fetchJson = createExchangeHttpClient({
    gates, sleep: async delay => { time += delay; }, geoBlocks: createGeoBlockRegistry({ now: () => time }),
    route: url => ({ url, headers: {} }),
    fetchImpl: async url => { sent.push({ url, time }); return binanceReply(url, time); },
  });
  return { fetchJson, sent, gate, now: () => time, advance: ms => { time += ms; } };
}
const ok = (body = []) => new Response(JSON.stringify(body), { status: 200, headers: { "x-mbx-used-weight-1m": "10" } });
const banUntil = until => new Response(JSON.stringify({ code: -1003, msg: `Way too many requests; IP(x) banned until ${until}.` }), { status: 418 });

test("after a restart into an active ban, exactly ONE request reaches Binance", async () => {
  const { fetchJson, sent, now } = harness(() => banUntil(now() + 43 * 3600_000));
  // Every module + many visitor refreshes start at once after a restart.
  const calls = Array.from({ length: 60 }, (_, i) =>
    fetchJson(i % 2 ? "https://fapi.binance.com/fapi/v1/exchangeInfo" : `https://fapi.binance.com/fapi/v1/openInterest?symbol=S${i}`).catch(error => error));
  const results = await Promise.all(calls);
  assert.equal(sent.length, 1, "only the probe was sent");
  assert.ok(results.every(result => result instanceof Error && /418/.test(result.message)));
  // Further refreshes during the ban send nothing at all.
  await fetchJson("https://fapi.binance.com/fapi/v1/ticker/24hr").catch(() => {});
  assert.equal(sent.length, 1);
});

test("when a pause ends, one probe goes first; the rest follow only after it succeeds", async () => {
  let banned = true;
  const { fetchJson, sent, now, advance } = harness(() => banned ? banUntil(now() + 60_000) : ok());
  await fetchJson("https://fapi.binance.com/fapi/v1/exchangeInfo").catch(() => {});
  advance(61_000); banned = false;
  const before = sent.length;
  await Promise.all(Array.from({ length: 5 }, (_, i) => fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=S${i}`)));
  const after = sent.slice(before);
  assert.equal(after.length, 5);
  // Probe was sent alone; the others started only after it was answered.
  assert.ok(after.slice(1).every(item => item.time > after[0].time));
});

test("a flood of visitor refreshes never exceeds the app's Binance budget", async () => {
  const { fetchJson, sent, gate, now } = harness(() => ok([]));
  // Record the limiter's own rolling windows at every admission.
  const windows = [];
  const checkpoint = gate.checkpoint.bind(gate);
  gate.checkpoint = () => {
    const at = gate.now();
    windows.push({
      weight: gate.general.reduce((sum, t, i) => sum + (t > at - 60_000 ? gate.generalCosts[i] : 0), 0),
      history: gate.history.filter(t => t > at - 300_000).length,
    });
    checkpoint();
  };
  const start = now();
  const urls = [];
  for (let i = 0; i < 1500; i++) {
    urls.push(i % 3 === 0 ? `https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=S${i}&period=1h&limit=500`
      : i % 3 === 1 ? `https://fapi.binance.com/fapi/v1/openInterest?symbol=S${i}`
        : `https://fapi.binance.com/fapi/v1/klines?symbol=S${i}&interval=1h&limit=1000`);
  }
  await Promise.all(urls.map(url => fetchJson(url)));
  assert.equal(sent.length, 1500);
  assert.ok(Math.max(...windows.map(w => w.weight)) <= 400, "≤ 400 of Binance's 2,400 weight/min");
  assert.ok(Math.max(...windows.map(w => w.history)) <= 450, "≤ 450 of Binance's 1,000 futures-data requests / 5 min");
  assert.ok(now() - start > 60_000, "excess demand waits instead of being sent");
});

test("a busy shared IP (high reported weight) makes the app back off for a minute", async () => {
  const { fetchJson, sent } = harness(() => new Response("[]", { status: 200, headers: { "x-mbx-used-weight-1m": "700" } }));
  await fetchJson("https://fapi.binance.com/fapi/v1/openInterest?symbol=A");
  await fetchJson("https://fapi.binance.com/fapi/v1/openInterest?symbol=B");
  assert.ok(sent[1].time - sent[0].time >= 60_000);
});

test("the default (non-probing) gate keeps its previous behaviour", async () => {
  let time = 0;
  const gate = new BinanceRequestGate({ now: () => time, sleep: async d => { time += d; }, spacingMs: 0 });
  await Promise.all([gate.enter("https://fapi.binance.com/fapi/v1/openInterest"), gate.enter("https://fapi.binance.com/fapi/v1/openInterest")]);
  assert.equal(time, 0);
});
