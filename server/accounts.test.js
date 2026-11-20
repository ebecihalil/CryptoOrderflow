import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAccountService, hashPassword, verifyPassword, createAttemptLimiter } from "./accounts.js";
import { createAccountRouter, readCookie, SESSION_COOKIE } from "./accountRoutes.js";

async function startServer(options = {}) {
  const accounts = createAccountService({ file: ":memory:" });
  const app = express();
  app.use(express.json());
  app.use("/api", createAccountRouter({ accounts, ...options }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const response = await fetch(base + path, { method, headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers,
    }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0].endsWith("=") ? "" : setCookie.split(";")[0];
    return { status: response.status, body: await response.json(), setCookie };
  };
  return { call, accounts, close: () => { server.close(); accounts.close(); }, setCookie: value => { cookie = value; } };
}

test("passwords are salted scrypt hashes and verify correctly", async () => {
  const a = await hashPassword("correct horse"), b = await hashPassword("correct horse");
  assert.notEqual(a, b, "random salt per hash");
  assert.ok(!a.includes("correct horse"));
  assert.equal(await verifyPassword("correct horse", a), true);
  assert.equal(await verifyPassword("wrong", a), false);
});

test("sign up, session cookie, sign out and sign back in", async () => {
  const t = await startServer();
  try {
    assert.deepEqual((await t.call("GET", "/api/auth/me")).body, { user: null });
    const signup = await t.call("POST", "/api/auth/signup", { email: "Trader@Example.com", password: "s3cret-pass" });
    assert.equal(signup.status, 201);
    assert.match(signup.setCookie, /cof_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000/);
    assert.deepEqual((await t.call("GET", "/api/auth/me")).body, { user: { email: "trader@example.com" } });
    const dup = await t.call("POST", "/api/auth/signup", { email: "trader@example.com", password: "another-pass" });
    assert.equal(dup.status, 409);
    await t.call("POST", "/api/auth/logout", {});
    assert.deepEqual((await t.call("GET", "/api/auth/me")).body, { user: null });
    assert.equal((await t.call("POST", "/api/auth/login", { email: "trader@example.com", password: "nope-nope" })).status, 401);
    const login = await t.call("POST", "/api/auth/login", { email: "TRADER@example.com", password: "s3cret-pass" });
    assert.equal(login.status, 200);
    assert.deepEqual((await t.call("GET", "/api/auth/me")).body, { user: { email: "trader@example.com" } });
  } finally { t.close(); }
});

test("watchlist requires an account and is private to each account", async () => {
  const t = await startServer();
  try {
    const anon = await t.call("POST", "/api/me/watchlist", { coin: "BTC" });
    assert.equal(anon.status, 401);
    assert.match(anon.body.error, /Sign in/);
    await t.call("POST", "/api/auth/signup", { email: "a@example.com", password: "password-a" });
    assert.deepEqual((await t.call("POST", "/api/me/watchlist", { coin: "btc" })).body, { coins: ["BTC"] });
    assert.deepEqual((await t.call("POST", "/api/me/watchlist", { coins: ["eth", "BTC", "bad coin!", "sol"] })).body.coins.sort(), ["BADCOIN", "BTC", "ETH", "SOL"].sort());
    assert.deepEqual((await t.call("DELETE", "/api/me/watchlist/BADCOIN")).body.coins.sort(), ["BTC", "ETH", "SOL"]);
    await t.call("POST", "/api/auth/logout", {});
    await t.call("POST", "/api/auth/signup", { email: "b@example.com", password: "password-b" });
    assert.deepEqual((await t.call("GET", "/api/me/watchlist")).body, { coins: [] }, "another user sees nothing");
  } finally { t.close(); }
});

test("cross-site and non-JSON mutations are rejected; forged cookies are ignored", async () => {
  const t = await startServer();
  try {
    const cross = await t.call("POST", "/api/auth/signup", { email: "x@example.com", password: "password-x" }, { origin: "https://evil.example" });
    assert.equal(cross.status, 403);
    const form = await t.call("POST", "/api/auth/logout", undefined, { "content-type": "application/x-www-form-urlencoded" });
    assert.equal(form.status, 415, "HTML form posts (classic CSRF) are refused");
    t.setCookie(`${SESSION_COOKIE}=forged-token-value-that-is-long-enough`);
    assert.deepEqual((await t.call("GET", "/api/auth/me")).body, { user: null });
    assert.equal(readCookie("a=1; cof_session=abc%20def; b=2", "cof_session"), "abc def");
  } finally { t.close(); }
});

test("weak input is rejected and repeated attempts are rate limited", async () => {
  const t = await startServer({ limiter: createAttemptLimiter({ limit: 3 }) });
  try {
    assert.equal((await t.call("POST", "/api/auth/signup", { email: "not-an-email", password: "longenough" })).status, 400);
    assert.equal((await t.call("POST", "/api/auth/signup", { email: "ok@example.com", password: "short" })).status, 400);
    assert.equal((await t.call("POST", "/api/auth/login", { email: "ok@example.com", password: "whatever1" })).status, 401);
    const limited = await t.call("POST", "/api/auth/login", { email: "ok@example.com", password: "whatever1" });
    assert.equal(limited.status, 429);
  } finally { t.close(); }
});

test("expired sessions stop working", async () => {
  let time = 1_000_000;
  const accounts = createAccountService({ file: ":memory:", now: () => time });
  const { token } = await accounts.signup("e@example.com", "password-e");
  assert.equal(accounts.userForToken(token).email, "e@example.com");
  time += 31 * 86_400_000;
  assert.equal(accounts.userForToken(token), null);
  accounts.close();
});

test("saved settings per account: allowed keys only, objects only, size-limited, private per user", async () => {
  const accounts = createAccountService({ file: ":memory:" });
  const a = await accounts.signup("prefs-a@example.com", "password-123");
  const b = await accounts.signup("prefs-b@example.com", "password-123");
  assert.equal(accounts.getPref(a.user.id, "market-list"), null);
  accounts.setPref(a.user.id, "market-list", { slots: ["bybit", null], colors: { "bybit:BTCUSDT": "blue" } });
  assert.deepEqual(accounts.getPref(a.user.id, "market-list").slots, ["bybit", null]);
  assert.equal(accounts.getPref(b.user.id, "market-list"), null, "another account never sees it");
  accounts.setPref(a.user.id, "market-list", { slots: ["okx"] });
  assert.deepEqual(accounts.getPref(a.user.id, "market-list"), { slots: ["okx"] }, "saving replaces");
  assert.throws(() => accounts.getPref(a.user.id, "other"), e => e.status === 404);
  assert.throws(() => accounts.setPref(a.user.id, "market-list", ["x"]), e => e.status === 400);
  assert.throws(() => accounts.setPref(a.user.id, "market-list", { big: "x".repeat(20_000) }), e => e.status === 413);
  accounts.close();
});

test("settings routes require sign-in", async () => {
  const accounts = createAccountService({ file: ":memory:" });
  const app = express(); app.use(express.json()); app.use("/api", createAccountRouter({ accounts }));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal((await fetch(`${base}/me/prefs/market-list`)).status, 401);
    const signup = await fetch(`${base}/auth/signup`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "prefs-route@example.com", password: "password-123" }) });
    const cookie = signup.headers.get("set-cookie").split(";")[0];
    const saved = await fetch(`${base}/me/prefs/market-list`, { method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ value: { oneRow: false } }) });
    assert.equal(saved.status, 200);
    assert.deepEqual((await (await fetch(`${base}/me/prefs/market-list`, { headers: { cookie } })).json()).value, { oneRow: false });
  } finally { server.close(); accounts.close(); }
});

test("Google sign-in: state checked, verified email signs in (and creates the account once)", async () => {
  const accounts = createAccountService({ file: ":memory:" });
  const google = { clientId: "cid", secret: "sec", redirectUri: "https://example.test/api/auth/google/callback" };
  let claims = { aud: "cid", iss: "https://accounts.google.com", email: "g-user@example.com", email_verified: true };
  const fetchJson = async url => url.includes("/token?") || url.endsWith("/token") ? { ok: true, body: { id_token: "x" } } : { ok: true, body: claims };
  const app = express(); app.use(express.json()); app.use("/api", createAccountRouter({ accounts, google, fetchJson }));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.deepEqual(await (await fetch(`${base}/auth/providers`)).json(), { google: true });
    const start = await fetch(`${base}/auth/google/start?next=/super-charts`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const location = new URL(start.headers.get("location"));
    assert.equal(location.hostname, "accounts.google.com");
    const state = location.searchParams.get("state");
    const cookie = start.headers.get("set-cookie").split(";")[0];
    const bad = await fetch(`${base}/auth/google/callback?code=c&state=wrong`, { redirect: "manual", headers: { cookie } });
    assert.match(bad.headers.get("location"), /^\/signin\?error=/);
    const ok = await fetch(`${base}/auth/google/callback?code=c&state=${state}`, { redirect: "manual", headers: { cookie } });
    assert.equal(ok.headers.get("location"), "/super-charts");
    const session = ok.headers.get("set-cookie").split(/,(?=\s*cof_)/).find(c => c.trim().startsWith("cof_session="));
    assert.ok(session && !session.includes("cof_session=;"));
    const me = await (await fetch(`${base}/auth/me`, { headers: { cookie: session.trim().split(";")[0] } })).json();
    assert.equal(me.user.email, "g-user@example.com");
    // Unverified email is refused.
    claims = { ...claims, email_verified: false };
    const again = await fetch(`${base}/auth/google/start`, { redirect: "manual" });
    const s2 = new URL(again.headers.get("location")).searchParams.get("state");
    const refused = await fetch(`${base}/auth/google/callback?code=c&state=${s2}`, { redirect: "manual", headers: { cookie: again.headers.get("set-cookie").split(";")[0] } });
    assert.match(refused.headers.get("location"), /not%20verified/);
    // A Google-created account cannot be signed into with a password.
    await assert.rejects(accounts.login("g-user@example.com", "google"), e => e.status === 401);
  } finally { server.close(); accounts.close(); }
});

test("Google sign-in is off without configuration", async () => {
  const accounts = createAccountService({ file: ":memory:" });
  const app = express(); app.use("/api", createAccountRouter({ accounts, google: null }));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.deepEqual(await (await fetch(`${base}/auth/providers`)).json(), { google: false });
    assert.equal((await fetch(`${base}/auth/google/start`, { redirect: "manual" })).status, 404);
  } finally { server.close(); accounts.close(); }
});
