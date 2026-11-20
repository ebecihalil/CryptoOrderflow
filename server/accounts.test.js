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
