import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Local runtime state, never credentials. One collector process owns this file.
 * Persistence survives process restarts only while its filesystem survives. */
export class RequestStateStore {
    constructor(path) {
        this.path = path;
        this.states = {};
        try {
            const file = JSON.parse(readFileSync(path, "utf8"));
            if (file.version !== 1 || !file.exchanges || typeof file.exchanges !== "object"
                || Array.isArray(file.exchanges)) throw new Error("Invalid request limiter state");
            this.states = file.exchanges;
        } catch (error) {
            if (error.code !== "ENOENT") throw new Error("Cannot safely load exchange request limiter state", { cause: error });
        }
    }

    read(exchange) { return this.states[exchange]; }

    save(exchange, state) {
        this.states[exchange] = state;
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            writeFileSync(`${this.path}.tmp`, JSON.stringify({ version: 1, exchanges: this.states }), { mode: 0o600 });
            renameSync(`${this.path}.tmp`, this.path);
        } catch (cause) {
            const error = new Error("Cannot safely save exchange request limiter state; outbound request stopped", { cause });
            error.retryable = false;
            throw error;
        }
    }
}
