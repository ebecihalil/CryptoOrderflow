import test from "node:test";
import assert from "node:assert/strict";
import { MODULES, HOME_MODULES } from "../src/lib/modules.ts";
import { readFileSync } from "node:fs";

test("home lists exactly the requested order-flow modules", () => {
    assert.deepEqual(HOME_MODULES.map(module => module.title), [
        "Long Short Account Ratio", "Funding Rate", "Open Interest",
        "Leverage Estimate", "Super Charts (Indicators)",
    ]);
});

test("Long Short Account Ratio is one home card that opens to Global and Top Trader", () => {
    const group = HOME_MODULES.find(module => module.title === "Long Short Account Ratio");
    assert.deepEqual(group.children.map(child => child.path), ["/long-short-account-ratio", "/top-trader-long-short-account-ratio"]);
    assert.ok(!HOME_MODULES.some(module => module.path === "/top-trader-long-short-account-ratio"));
});

test("CVD and Liquidations are hidden only from the main page, not deleted", () => {
    for (const path of ["/cvd", "/liquidations"]) {
        assert.ok(MODULES.some(module => module.path === path));
        assert.ok(!HOME_MODULES.some(module => module.path === path));
    }
    const home = readFileSync(new URL("../src/components/module-pages.tsx", import.meta.url), "utf8");
    assert.match(home, /HOME_MODULES\.map/);
    assert.match(home, /HOME_MODULES\.length/);
    assert.doesNotMatch(home, /06 MODULES/);
});

test("Super Charts keeps its entry class and responsive resets", () => {
    const home = readFileSync(new URL("../src/components/module-pages.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/styles/modules.css", import.meta.url), "utf8");
    assert.match(home, /module\.path === '\/super-charts'/);
    assert.match(home, /module-entry-super-charts/);
    // Super Charts flows naturally in the grid; no forced column placement.
    assert.doesNotMatch(css, /\.module-entry-super-charts\s*\{[^}]*grid-column:\s*2\s*;/);
    assert.match(css, /@media[\s\S]*\.module-entry-super-charts\s*\{[^}]*grid-column:\s*auto\s*;/);
});

test("account ratio has no position ratio subsection", () => {
    assert.equal(MODULES[0].path, "/long-short-account-ratio");
    assert.ok(MODULES.every(module => !module.path.includes("position-ratio")));
    const home = readFileSync(new URL("../src/components/module-pages.tsx", import.meta.url), "utf8");
    // The LSAR card expands to Global / Top Trader account ratios only.
    assert.doesNotMatch(home, /ratioOpen|RATIO_SECTIONS|position-ratio/);
    assert.match(home, /href=\{module\.path\}/);
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(app, /long-short-position-ratio|RATIO_SECTIONS|sectionLabel="Long Short Ratio"/);
    assert.match(app, /path="\/long-short-account-ratio" component=\{Home\}/);
    assert.match(app, /path="\/lsar" component=\{LsarAlias\}/);
});

test("each selected section has a two-letter mark and a unique local route", () => {
    const pages = MODULES;
    assert.equal(new Set(pages.map(page => page.path)).size, 8);
    for (const page of pages) {
        assert.match(page.mark, /^[A-Z]{2}$/);
        assert.match(page.path, /^\/[a-z-]+$/);
    }
});
