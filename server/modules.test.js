import test from "node:test";
import assert from "node:assert/strict";
import { MODULES, RATIO_SECTIONS } from "../src/lib/modules.ts";

test("home lists exactly the requested order-flow modules", () => {
    assert.deepEqual(MODULES.map(module => module.title), [
        "Long Short Ratio", "Funding Rate", "Open Interest", "Liquidations",
        "CVD", "Super Charts (Indicators)",
    ]);
});

test("Long Short Ratio has distinct account and position screens", () => {
    assert.deepEqual(RATIO_SECTIONS.map(section => [section.title, section.path]), [
        ["Long Short Account Ratio", "/long-short-account-ratio"],
        ["Long Short Position Ratio", "/long-short-position-ratio"],
    ]);
    assert.equal(MODULES[0].path, RATIO_SECTIONS[0].path);
});

test("each selected section has a two-letter mark and a unique local route", () => {
    const pages = [...RATIO_SECTIONS, ...MODULES.slice(1)];
    assert.equal(new Set(pages.map(page => page.path)).size, 7);
    for (const page of pages) {
        assert.match(page.mark, /^[A-Z]{2}$/);
        assert.match(page.path, /^\/[a-z-]+$/);
    }
});
