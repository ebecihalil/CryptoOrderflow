import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const statusLine = readFileSync(new URL("../src/components/fetched-data-line.tsx", import.meta.url), "utf8");
test("LSAR removes the maximum-price control and explicitly requests uncapped data", () => {
    assert.doesNotMatch(app, /setMaxPrice|maxPriceLimit|serverPriceFilter|input-max-price|Maximum coin price|Max price|price ≤/);
    assert.match(app, /queryKey: \['market-snapshot', 'all'\]/);
    assert.match(app, /getJson<LsarMarketSnapshot>\('\/api\/market\/lsar\?maxPrice=all', signal\)/);
    assert.match(app, /const hasActiveFilters = Boolean\(search\.trim\(\)\) \|\| selectedExchanges\.length !== MARKET_EXCHANGES\.length \|\| multipleOnly;/);
});
test("LSAR keeps error-dot detection but removes failure prose from labels and tooltips", () => {
    assert.match(statusLine, /sourceFailureLabel\(source\?\.error\)/);
    assert.match(statusLine, /source\?\.status === 'error' \|\| failureLabel \? 'error' : 'pending'/);
    assert.match(statusLine, /fetched-data-dot \$\{state\}/);
    assert.match(statusLine, /<span>\{EXCHANGE_LABELS\[exchange\]\} \{count\.toLocaleString\(\)\}<\/span>/);
    assert.doesNotMatch(statusLine, /\$\{failureLabel\}|Partial feed|source\.error|IP blocked|before price/);
    assert.match(statusLine, /aria-label=/);
    assert.match(statusLine, /Total Fetched Coin Data:/);
});
