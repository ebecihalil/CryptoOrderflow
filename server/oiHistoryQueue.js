/** FIFO queues per venue; requests themselves still pass through shared gates. */
export function createOiHistoryQueue({ fetchHistory, onPoints, supported, needed,
    isCoolingDown = () => false, clock = Date.now, concurrency = 2 }) {
    const queues = new Map(), waiting = new Map(), active = new Map(), running = new Set(), attempts = new Map();
    const keyOf = item => `${item.exchange}:${item.symbol}`;
    function pump(exchange) {
        if (isCoolingDown(exchange)) return;
        const queue = queues.get(exchange) ?? [];
        while (queue.length && (active.get(exchange) ?? 0) < concurrency) {
            const key = queue.shift(), item = waiting.get(key);
            waiting.delete(key);
            if (!item || !needed(item)) continue;
            running.add(key); active.set(exchange, (active.get(exchange) ?? 0) + 1);
            attempts.set(key, { time: clock(), ok: false });
            Promise.resolve().then(() => fetchHistory(item, clock())).then(points => {
                onPoints(item, points);
                attempts.set(key, { time: clock(), ok: points.length > 0 });
            }).catch(() => {
                // Failures get a bounded retry delay, never fake historical zeroes.
                attempts.set(key, { time: clock(), ok: false });
            }).finally(() => {
                running.delete(key); active.set(exchange, active.get(exchange) - 1);
                pump(exchange); // Drain without waiting for another browser request.
            });
        }
    }
    return {
        schedule(items) {
            for (const item of items) {
                if (!supported(item)) continue;
                const key = keyOf(item), attempt = attempts.get(key);
                if (waiting.has(key)) { waiting.set(key, item); continue; }
                if (running.has(key) || !needed(item) ||
                    (attempt && clock() - attempt.time < (attempt.ok ? 1800_000 : 300_000))) continue;
                if (!queues.has(item.exchange)) queues.set(item.exchange, []);
                queues.get(item.exchange).push(key); waiting.set(key, item);
            }
            for (const exchange of queues.keys()) pump(exchange);
        },
        get pendingCount() { return waiting.size + running.size; },
    };
}
