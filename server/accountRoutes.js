import express from "express";
import { AccountError, SESSION_TTL_MS, createAttemptLimiter } from "./accounts.js";

export const SESSION_COOKIE = "cof_session";

export function readCookie(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

/**
 * /api/auth/*, /api/me/watchlist and /api/me/prefs/:key. Mutations must come from this site
 * (Origin check) as JSON; the session cookie is HttpOnly + SameSite=Lax.
 */
export function createAccountRouter({ accounts, limiter = createAttemptLimiter(), emailLimiter = createAttemptLimiter() }) {
  const router = express.Router();
  const sessionCookie = (req, token, maxAgeMs) => [
    `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ""}`, "Path=/", "HttpOnly", "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`, ...(req.secure ? ["Secure"] : []),
  ].join("; ");
  const currentUser = req => accounts.userForToken(readCookie(req.headers.cookie, SESSION_COOKIE));

  const guard = handler => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (req.method !== "GET") {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
          throw new AccountError(403, "Requests must come from this site.");
        // HTML forms can only POST url-encoded/multipart bodies; require JSON so a
        // cross-site form cannot submit. (Cross-site DELETE needs a CORS preflight
        // this server never approves.)
        if (req.method === "POST" && !req.is("application/json")) throw new AccountError(415, "JSON body required.");
      }
      await handler(req, res);
    } catch (error) {
      const status = error instanceof AccountError ? error.status : 500;
      if (status === 500) console.error("Account request failed", error?.message);
      res.status(status).json({ error: status === 500 ? "Something went wrong. Please try again." : error.message });
    }
  };
  const throttle = (req, email) => {
    if (!limiter.hit(`ip:${req.ip}`) || (email && !emailLimiter.hit(`email:${String(email).trim().toLowerCase()}`)))
      throw new AccountError(429, "Too many attempts. Please wait 15 minutes and try again.");
  };
  const requireUser = req => {
    const user = currentUser(req);
    if (!user) throw new AccountError(401, "Sign in to use your watchlist.");
    return user;
  };

  router.get("/auth/me", guard((req, res) => {
    const user = currentUser(req);
    res.json({ user: user ? { email: user.email } : null });
  }));
  router.post("/auth/signup", guard(async (req, res) => {
    throttle(req, req.body?.email);
    const result = await accounts.signup(req.body?.email, req.body?.password);
    res.setHeader("Set-Cookie", sessionCookie(req, result.token, SESSION_TTL_MS));
    res.status(201).json({ user: { email: result.user.email } });
  }));
  router.post("/auth/login", guard(async (req, res) => {
    throttle(req, req.body?.email);
    const result = await accounts.login(req.body?.email, req.body?.password);
    res.setHeader("Set-Cookie", sessionCookie(req, result.token, SESSION_TTL_MS));
    res.json({ user: { email: result.user.email } });
  }));
  router.post("/auth/logout", guard((req, res) => {
    accounts.logout(readCookie(req.headers.cookie, SESSION_COOKIE));
    res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
    res.json({ user: null });
  }));

  router.get("/me/watchlist", guard((req, res) => {
    res.json({ coins: accounts.watchlist(requireUser(req).id) });
  }));
  router.post("/me/watchlist", guard((req, res) => {
    const user = requireUser(req);
    const coins = Array.isArray(req.body?.coins) ? req.body.coins.slice(0, 60) : [req.body?.coin];
    let list = accounts.watchlist(user.id);
    for (const coin of coins) {
      try { list = accounts.addWatch(user.id, coin); }
      catch (error) { if (coins.length === 1) throw error; } // bulk import: skip invalid/overflow
    }
    res.json({ coins: list });
  }));
  router.delete("/me/watchlist/:coin", guard((req, res) => {
    res.json({ coins: accounts.removeWatch(requireUser(req).id, req.params.coin) });
  }));
  // Saved settings for signed-in users (market list colours, filters, exchange priority).
  router.get("/me/prefs/:key", guard((req, res) => {
    res.json({ value: accounts.getPref(requireUser(req).id, req.params.key) });
  }));
  router.post("/me/prefs/:key", guard((req, res) => {
    res.json({ value: accounts.setPref(requireUser(req).id, req.params.key, req.body?.value) });
  }));
  return router;
}
