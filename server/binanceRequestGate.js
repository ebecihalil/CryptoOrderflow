const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class BinanceCooldownError extends Error {
    constructor(status, retryAt) {
        super(`Binance HTTP ${status}: ${status === 418 ? "IP temporarily blocked" : "rate limited"}. Requests paused until ${new Date(retryAt).toISOString()}.`);
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
    } = {}) {
        Object.assign(this, { now, sleep, spacingMs, historyLimit, historyWindowMs, generalLimit, generalWindowMs });
        this.history = [];
        this.general = [];
        this.nextStart = 0;
        this.blockedUntil = 0;
        this.blockedStatus = 429;
        this.queue = Promise.resolve();
    }

    get isCoolingDown() { return this.now() < this.blockedUntil; }

    cooldownError() { return new BinanceCooldownError(this.blockedStatus, this.blockedUntil); }

    checkCooldown() {
        if (this.isCoolingDown) throw this.cooldownError();
    }

    async enter(url) {
        const task = this.queue.then(async () => {
            const history = new URL(url).pathname.startsWith("/futures/data/");
            const windowMs = history ? this.historyWindowMs : this.generalWindowMs;
            const limit = history ? this.historyLimit : this.generalLimit;
            while (true) {
                this.checkCooldown();
                const now = this.now();
                this.history = this.history.filter(time => time > now - this.historyWindowMs);
                this.general = this.general.filter(time => time > now - this.generalWindowMs);
                const starts = history ? this.history : this.general;
                const delay = Math.max(0, this.nextStart - now,
                    starts.length >= limit ? starts[0] + windowMs - now + 1 : 0);
                if (delay) {
                    await this.sleep(delay);
                    continue;
                }
                starts.push(now);
                this.nextStart = now + this.spacingMs;
                return;
            }
        });
        this.queue = task.catch(() => {});
        await task;
    }

    async inspect(response) {
        if (response.status !== 418 && response.status !== 429) {
            // Headers reflect usage by the whole outgoing IP, not just us.
            // Leave substantial headroom below the usual futures weight limit.
            const weight = Number(response.headers.get("x-mbx-used-weight-1m"));
            if (response.ok && Number.isFinite(weight) && weight >= 1000)
                this.nextStart = Math.max(this.nextStart, this.now() + 60_000);
            return;
        }
        // Pause immediately, before reading the error body, so queued requests
        // cannot keep hitting Binance while its ban deadline is being parsed.
        const now = this.now();
        const ongoingBan = this.isCoolingDown && this.blockedStatus === 418;
        const priorDeadline = this.blockedUntil;
        this.blockedStatus = ongoingBan ? 418 : response.status;
        const raw = response.headers.get("retry-after");
        const seconds = raw === null ? NaN : Number(raw);
        const headerDeadline = Number.isFinite(seconds) && seconds >= 0
            ? now + seconds * 1000 : Date.parse(raw ?? "");
        const fallback = now + (response.status === 418 ? 15 * 60_000 : 60_000);
        const provisionalDeadline = Math.max(priorDeadline, now + 1000,
            Number.isFinite(headerDeadline) && headerDeadline > now ? headerDeadline : fallback);
        this.blockedUntil = provisionalDeadline;
        const body = await response.clone().json().catch(() => null);
        const match = String(body?.msg ?? "").match(/banned until\s+(\d{10,13})\b/i);
        const epoch = match ? Number(match[1]) : NaN;
        const bodyDeadline = epoch < 1e12 ? epoch * 1000 : epoch;
        const deadlines = [headerDeadline, bodyDeadline].filter(value => Number.isFinite(value) && value > now);
        const deadline = Math.max(priorDeadline, now + 1000, ...(deadlines.length ? deadlines : [fallback]));
        // Refine our provisional deadline, but never overwrite a longer
        // cooldown reported by another in-flight response.
        this.blockedUntil = this.blockedUntil === provisionalDeadline
            ? deadline : Math.max(this.blockedUntil, deadline);
        throw this.cooldownError();
    }
}
