const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class BinanceCooldownError extends Error {
    constructor(status, retryAt) {
        super(`Binance HTTP ${status}: ${status === 418 ? "IP temporarily blocked" : status === 403 ? "access temporarily blocked" : "rate limited"}. Requests paused until ${new Date(retryAt).toISOString()}.`);
        this.name = "BinanceCooldownError";
        this.status = status;
        this.retryAt = retryAt;
    }
}

/** Shared by USD-M and COIN-M, including retries. Exchange timeouts begin only
 * after admission; queued requests must not consume their network timeout. */
export class BinanceRequestGate {
    constructor({
        now = Date.now, sleep = wait, spacingMs = 75,
        historyLimit = 900, historyWindowMs = 300_000,
        generalLimit = 500, generalWindowMs = 60_000,
        state, save = () => {},
    } = {}) {
        Object.assign(this, { now, sleep, spacingMs, historyLimit, historyWindowMs, generalLimit, generalWindowMs, save });
        this.history = [];
        this.funding = [];
        this.general = [];
        this.generalCosts = [];
        this.nextStart = 0;
        this.blockedUntil = 0;
        this.blockedStatus = 429;
        this.backoffLevel = 0;
        this.lastLimitAt = 0;
        if (state) {
            for (const key of ["nextStart", "blockedUntil", "blockedStatus", "backoffLevel", "lastLimitAt"])
                if (!Number.isFinite(state[key]) || state[key] < 0) throw new Error("Invalid Binance limiter state");
            for (const key of ["history", "general", "generalCosts"])
                if (!Array.isArray(state[key]) || !state[key].every(value => Number.isFinite(value) && value >= 0))
                    throw new Error("Invalid Binance request window");
            if (state.general.length !== state.generalCosts.length || state.generalCosts.some(cost => cost <= 0))
                throw new Error("Invalid Binance request weights");
            for (const key of ["history", "general", "generalCosts", "nextStart", "blockedUntil", "blockedStatus", "backoffLevel", "lastLimitAt"])
                this[key] = state[key];
            if (state.funding !== undefined && (!Array.isArray(state.funding) || !state.funding.every(Number.isFinite)))
                throw new Error("Invalid Binance funding request window");
            this.funding = state.funding ?? [];
        }
        this.queue = Promise.resolve();
    }

    checkpoint() {
        const { history, funding, general, generalCosts, nextStart, blockedUntil, blockedStatus, backoffLevel, lastLimitAt } = this;
        this.save({ history, funding, general, generalCosts, nextStart, blockedUntil, blockedStatus, backoffLevel, lastLimitAt });
    }

    get isCoolingDown() { return this.now() < this.blockedUntil; }

    cooldownError() { return new BinanceCooldownError(this.blockedStatus, this.blockedUntil); }

    checkCooldown() {
        if (this.isCoolingDown) throw this.cooldownError();
    }

    async enter(url) {
        const task = this.queue.then(async () => {
            const parsed = new URL(url);
            const history = parsed.pathname.startsWith("/futures/data/");
            const funding = /\/funding(Rate|Info)$/.test(parsed.pathname);
            // Bulk tickers carry more weight than a single-symbol OI call.
            // Reserve conservatively for both USD-M and COIN-M variants.
            const candleLimit = Number(parsed.searchParams.get("limit") || 500);
            const cost = parsed.pathname.endsWith("/klines")
                ? (candleLimit < 100 ? 1 : candleLimit < 500 ? 2 : candleLimit <= 1000 ? 5 : 10)
                : parsed.pathname === "/api/v3/exchangeInfo" ? 20
                : parsed.pathname.endsWith("/exchangeInfo") ? 5
                : parsed.pathname.endsWith("/openInterest") ? 1
                : parsed.searchParams.has("symbol") ? 2 : 50;
            const windowMs = funding ? 300_000 : history ? this.historyWindowMs : this.generalWindowMs;
            const limit = funding ? 350 : history ? this.historyLimit : this.generalLimit;
            if (!history && !funding && cost > limit) throw new Error("Binance request exceeds configured weight allowance");
            while (true) {
                this.checkCooldown();
                const now = this.now();
                this.history = this.history.filter(time => time > now - this.historyWindowMs);
                this.funding = this.funding.filter(time => time > now - 300_000);
                const retained = this.general.map((time, index) => ({ time, cost: this.generalCosts[index] }))
                    .filter(entry => entry.time > now - this.generalWindowMs);
                this.general = retained.map(entry => entry.time);
                this.generalCosts = retained.map(entry => entry.cost);
                const starts = funding ? this.funding : history ? this.history : this.general;
                let quotaDelay = 0;
                if ((history || funding) && starts.length >= limit) quotaDelay = starts[starts.length - limit] + windowMs - now + 1;
                if (!history && !funding) {
                    let total = this.generalCosts.reduce((sum, value) => sum + value, 0);
                    for (let i = 0; total + cost > limit && i < starts.length; i++) {
                        total -= this.generalCosts[i];
                        quotaDelay = starts[i] + windowMs - now + 1;
                    }
                }
                const delay = Math.max(0, this.nextStart - now, quotaDelay);
                if (delay) {
                    await this.sleep(delay);
                    continue;
                }
                starts.push(now);
                if (!history && !funding) this.generalCosts.push(cost);
                this.nextStart = now + this.spacingMs;
                this.checkpoint();
                return;
            }
        });
        this.queue = task.catch(() => {});
        await task;
    }

    async inspect(response) {
        if (![418, 429, 403].includes(response.status)) {
            // Headers reflect usage by the whole outgoing IP, not just us.
            // Leave substantial headroom below the usual futures weight limit.
            const weight = Number(response.headers.get("x-mbx-used-weight-1m"));
            if (response.ok && Number.isFinite(weight) && weight >= 1000) {
                this.nextStart = Math.max(this.nextStart, this.now() + 60_000);
                this.checkpoint();
            }
            return;
        }
        // Pause immediately, before reading the error body, so queued requests
        // cannot keep hitting Binance while its ban deadline is being parsed.
        const now = this.now();
        const ongoingBan = this.isCoolingDown && [418, 403].includes(this.blockedStatus);
        const priorDeadline = this.blockedUntil;
        this.blockedStatus = response.status === 418 || (ongoingBan && this.blockedStatus === 418) ? 418
            : ongoingBan ? this.blockedStatus : response.status;
        const raw = response.headers.get("retry-after");
        const seconds = raw === null ? NaN : Number(raw);
        const headerDeadline = Number.isFinite(seconds) && seconds >= 0
            ? now + seconds * 1000 : Date.parse(raw ?? "");
        if (now - this.lastLimitAt > 3_600_000) this.backoffLevel = 0;
        this.backoffLevel = Math.min(6, this.backoffLevel + 1);
        this.lastLimitAt = now;
        const fallback = now + Math.max(response.status === 429 ? 0 : 15 * 60_000,
            60_000 * 2 ** (this.backoffLevel - 1));
        const provisionalDeadline = Math.max(priorDeadline, now + (response.status === 403 ? 900_000 : 1000),
            Number.isFinite(headerDeadline) && headerDeadline > now ? headerDeadline : fallback);
        this.blockedUntil = provisionalDeadline;
        this.checkpoint();
        const body = await response.clone().json().catch(() => null);
        const match = String(body?.msg ?? "").match(/banned until\s+(\d{10,13})\b/i);
        const epoch = match ? Number(match[1]) : NaN;
        const bodyDeadline = epoch < 1e12 ? epoch * 1000 : epoch;
        const deadlines = [headerDeadline, bodyDeadline].filter(value => Number.isFinite(value) && value > now);
        const deadline = Math.max(priorDeadline, now + (response.status === 403 ? 900_000 : 1000), ...(deadlines.length ? deadlines : [fallback]));
        // Refine our provisional deadline, but never overwrite a longer
        // cooldown reported by another in-flight response.
        this.blockedUntil = this.blockedUntil === provisionalDeadline
            ? deadline : Math.max(this.blockedUntil, deadline);
        this.checkpoint();
        throw this.cooldownError();
    }

    async inspectBody(body, response) {
        if (String(body?.code) === "-1003")
            await this.inspect(new Response(JSON.stringify(body), {
                status: /banned until/i.test(String(body.msg)) ? 418 : 429, headers: response.headers,
            }));
    }
}
