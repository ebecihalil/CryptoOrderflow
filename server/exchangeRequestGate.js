const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
const rule = (key, limit, windowMs, match = () => true) => ({ key, limit, windowMs, match });

/** Reviewed 2026-10-13. These are deliberately LOWER than published ceilings.
 * Sources, endpoint scope and undocumented limits: docs/exchange-request-limits.md */
export const EXCHANGE_POLICIES = {
    bybit: { spacingMs: 160, rules: [rule("all", 30, 5000)] },
    okx: { spacingMs: 600, rules: [rule("all", 3, 2000)] },
    gate: { spacingMs: 150, rules: [rule("all", 80, 10_000)] },
    bitget: { spacingMs: 150, rules: [
        rule("all", 8, 1000),
        rule("account-ratio", 1, 1250, url => url.pathname.endsWith("/account-long-short")),
    ] },
    // No numeric LSAR endpoint limit/weight is published. Do not equate the
    // general 3000-weight allowance with 3000 account-ratio requests.
    toobit: { spacingMs: 1100, rules: [rule("all", 50, 60_000)] },
};

export class ExchangeCooldownError extends Error {
    constructor(exchange, status, retryAt, code) {
        super(`${exchange.toUpperCase()} HTTP ${status}: ${status === 403 || status === 418 ? "access temporarily blocked" : "rate limited"}${code ? ` (exchange code ${code})` : ""}. Requests paused until ${new Date(retryAt).toISOString()}.`);
        this.name = "ExchangeCooldownError";
        Object.assign(this, { exchange, status, retryAt, retryable: false });
    }
}

function timestamp(raw) {
    if (raw === null || raw === undefined || raw === "") return NaN;
    const value = Number(raw);
    return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : NaN;
}

export class ExchangeRequestGate {
    constructor(exchange, {
        policy = EXCHANGE_POLICIES[exchange], now = Date.now, sleep = wait,
        state, save = () => {},
    } = {}) {
        if (!policy) throw new Error(`Missing exchange request policy: ${exchange}`);
        Object.assign(this, { exchange, policy, now, sleep, save });
        this.queue = Promise.resolve();
        this.buckets = {};
        this.nextStart = 0;
        this.blockedUntil = 0;
        this.blockedStatus = 429;
        this.backoffLevel = 0;
        this.lastLimitAt = 0;
        if (state) {
            for (const key of ["nextStart", "blockedUntil", "blockedStatus", "backoffLevel", "lastLimitAt"])
                if (!Number.isFinite(state[key]) || state[key] < 0) throw new Error(`Invalid ${exchange} limiter state`);
            if (!state.buckets || typeof state.buckets !== "object" || Array.isArray(state.buckets))
                throw new Error(`Invalid ${exchange} request windows`);
            for (const entries of Object.values(state.buckets))
                if (!Array.isArray(entries) || !entries.every(value => Number.isFinite(value) && value >= 0))
                    throw new Error(`Invalid ${exchange} request window`);
            for (const key of ["buckets", "nextStart", "blockedUntil", "blockedStatus", "backoffLevel", "lastLimitAt"])
                this[key] = state[key];
        }
    }

    checkpoint() {
        const { buckets, nextStart, blockedUntil, blockedStatus, backoffLevel, lastLimitAt } = this;
        this.save({ buckets, nextStart, blockedUntil, blockedStatus, backoffLevel, lastLimitAt });
    }
    get isCoolingDown() { return this.now() < this.blockedUntil; }
    cooldownError() { return new ExchangeCooldownError(this.exchange, this.blockedStatus, this.blockedUntil); }
    checkCooldown() { if (this.isCoolingDown) throw this.cooldownError(); }

    async enter(value) {
        const url = new URL(value);
        const task = this.queue.then(async () => {
            while (true) {
                this.checkCooldown();
                const now = this.now();
                let delay = Math.max(0, this.nextStart - now);
                const selected = this.policy.rules.filter(item => item.match(url));
                for (const item of selected) {
                    const starts = (this.buckets[item.key] ?? []).filter(time => time > now - item.windowMs);
                    this.buckets[item.key] = starts;
                    if (starts.length >= item.limit)
                        delay = Math.max(delay, starts[starts.length - item.limit] + item.windowMs - now + 1);
                }
                if (delay) { await this.sleep(delay); continue; }
                for (const item of selected) this.buckets[item.key].push(now);
                this.nextStart = now + this.policy.spacingMs;
                this.checkpoint(); // Failure stops the request, rather than losing its quota accounting.
                return;
            }
        });
        this.queue = task.catch(() => {});
        await task;
    }

    deadline(response) {
        const raw = response.headers.get("retry-after");
        const seconds = raw === null || raw === "" ? NaN : Number(raw);
        const retryAfter = Number.isFinite(seconds) && seconds >= 0
            ? this.now() + seconds * 1000 : Date.parse(raw ?? "");
        return Math.max(0, ...[
            retryAfter,
            timestamp(response.headers.get("x-bapi-limit-reset-timestamp")),
            timestamp(response.headers.get("x-api-limit-reset-timestamp")),
            timestamp(response.headers.get("x-gate-ratelimit-reset-timestamp")),
        ].filter(value => Number.isFinite(value) && value > this.now()));
    }

    pause(response, status = response.status, code) {
        const now = this.now();
        const ongoingBan = this.isCoolingDown && [403, 418].includes(this.blockedStatus);
        if (now - this.lastLimitAt > 3_600_000) this.backoffLevel = 0;
        this.backoffLevel = Math.min(6, this.backoffLevel + 1);
        this.lastLimitAt = now;
        const reported = this.deadline(response);
        const minimum = status === 403 || status === 418 ? 15 * 60_000 : 1000;
        const fallback = now + 60_000 * 2 ** (this.backoffLevel - 1);
        this.blockedUntil = Math.max(this.blockedUntil, now + minimum,
            reported ? reported + 1000 : fallback);
        this.blockedStatus = status === 418 || (ongoingBan && this.blockedStatus === 418) ? 418
            : ongoingBan ? this.blockedStatus : status;
        this.checkpoint();
        return new ExchangeCooldownError(this.exchange, this.blockedStatus, this.blockedUntil, code);
    }

    /** HTTP status is inspected BEFORE error-body parsing to stop queued traffic. */
    inspect(response) {
        if ([429, 418, 403].includes(response.status)) throw this.pause(response);
        if (!response.ok) return;
        const pairs = [
            ["x-bapi-limit-status", "x-bapi-limit"],
            ["x-api-limit-status", "x-api-limit"],
            ["x-gate-ratelimit-requests-remain", "x-gate-ratelimit-limit"],
        ];
        for (const [remainingName, limitName] of pairs) {
            const raw = response.headers.get(remainingName);
            if (raw === null) continue;
            const remaining = Number(raw), limit = Number(response.headers.get(limitName));
            if (Number.isFinite(remaining) && remaining <= Math.max(2, Number.isFinite(limit) ? Math.ceil(limit * 0.1) : 2)) {
                const deadline = this.deadline(response);
                this.nextStart = Math.max(this.nextStart, deadline ? deadline + 1000
                    : this.now() + Math.max(...this.policy.rules.map(item => item.windowMs)));
                this.checkpoint();
            }
        }
    }

    /** Exchanges can report rate limits in a JSON body with HTTP 200. */
    inspectBody(body, response) {
        const code = String(body?.retCode ?? body?.code ?? "");
        const message = String(body?.retMsg ?? body?.msg ?? body?.message ?? "");
        if (code === "10009" || /IP.*bann|access too frequent/i.test(message))
            throw this.pause(response, 403, code);
        if (["10006", "50011", "50013", "429", "-1003", "-1015"].includes(code)
            || body?.label === "TOO_MANY_REQUESTS"
            || (code && !["0", "00000"].includes(code) && /too many requests|too many visits|too frequent|rate limit|frequency limit/i.test(message)))
            throw this.pause(response, 429, code);
    }
}
