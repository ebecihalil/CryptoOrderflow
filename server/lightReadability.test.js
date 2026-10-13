import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/light-readability.css", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
const guard = ":root:not(.dark):not([data-theme='dark'])";

test("all readability overrides exclude dark mode", () => {
    for (const match of css.matchAll(/([^{}]+)\{/g)) {
        const selector = match[1].trim();
        if (selector.startsWith("@media")) continue;
        assert.ok(selector.startsWith(guard), `Unguarded style: ${selector}`);
    }
});

test("light mode keeps readable table values, captions, headings and fetched counts", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const [selector, size] of [[".market-table", 14], [".market-table th", 12], [".subhead", 11], [".asset-name", 15], [".fetched-data-line", 14]]) {
        const rule = rules.find((match) => match[1].trim() === `${guard} ${selector}`);
        assert.ok(rule, selector);
        assert.match(rule[2], new RegExp(`font-size:\\s*${size}px`));
    }
});
