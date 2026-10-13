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

test("light mode increases table text, captions and headers by one pixel", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const [selector, size] of [[".market-table", 12], [".market-table th", 10], [".subhead", 9], [".asset-name", 13]]) {
        const rule = rules.find((match) => match[1].trim() === `${guard} ${selector}`);
        assert.ok(rule, selector);
        assert.match(rule[2], new RegExp(`font-size:\\s*${size}px`));
    }
});
