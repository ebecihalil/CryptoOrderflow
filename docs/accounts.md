# Accounts and the personal watchlist

Free accounts unlock the watchlist. Everything else (all screeners, charts,
recent coins) stays open without an account.

## Behaviour

- Signed-out visitors see the ☆ stars and the "Watchlist only" button with a
  lock. Using them opens "Create a free account to use your watchlist" with
  **Sign up free** / **I have an account**; after signing up or in, the visitor
  returns to the same page.
- Signed-in users: the watchlist is stored on the server per account, so it
  follows them across devices. Max 50 coins. A watchlist saved in the browser
  before accounts existed is imported on first sign-in.
- Recent coins stay per browser and per section, with no account needed.
- Header: **Sign in** when signed out; the account email with **Sign out**
  when signed in.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/auth/me` | `{ user: { email } \| null }` |
| POST | `/api/auth/signup` | `{ email, password }` (min 8 chars) → sets session cookie |
| POST | `/api/auth/login` | `{ email, password }` → sets session cookie |
| POST | `/api/auth/logout` | clears the session |
| GET | `/api/me/watchlist` | `{ coins }`, 401 when signed out |
| POST | `/api/me/watchlist` | `{ coin }` or `{ coins: [...] }` |
| DELETE | `/api/me/watchlist/:coin` | |

## Security

- Passwords: scrypt (N=16384, r=8, p=1) with a random salt per user, compared
  in constant time. Unknown emails cost the same work (no timing hint).
- Sessions: random 32-byte token in an `HttpOnly; SameSite=Lax` cookie (plus
  `Secure` behind HTTPS); only its SHA-256 hash is stored. 30-day expiry.
- Mutations must come from this site (Origin check), and POSTs must be JSON,
  so cross-site forms cannot act for a user. No CORS is enabled.
- Sign-up/sign-in: 10 attempts per 15 minutes per IP and per email.
- `trust proxy` covers loopback/private proxies (Caddy), so rate limits see the
  real client IP and cookies are `Secure` over HTTPS. Override with
  `TRUST_PROXY` if the app sits behind a different proxy.
- Post-login redirects only accept same-site paths.

## Storage and operations

SQLite via Node's built-in `node:sqlite` (no dependency): `.cache/accounts.sqlite`,
or `$ACCOUNTS_DB`. The file is git-ignored. On the Oracle VM it lives at
`/opt/crypto/.cache/accounts.sqlite` and survives `git pull`, rebuilds and
restarts. **Back it up** (it holds all accounts), e.g.:

```bash
sqlite3 /opt/crypto/.cache/accounts.sqlite ".backup /root/accounts-$(date +%F).sqlite"
```

On hosts with ephemeral disks (Render free), accounts would be lost on every
redeploy. Use a persistent disk and point `ACCOUNTS_DB` at it.

## Not included yet

- Email verification and password reset (needs an email-sending service).
- Paid plans (e.g. Stripe). Accounts are free; a plan field can be added later.
