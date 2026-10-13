import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { nextTheme, resolveTheme, THEME_STORAGE_KEY } from "../src/lib/theme.ts";

test("explicit saved preference overrides the device theme", () => {
    assert.equal(resolveTheme("light", true), "light");
    assert.equal(resolveTheme("dark", false), "dark");
});

test("unset or invalid preferences follow the device setting", () => {
    assert.equal(resolveTheme(null, true), "dark");
    assert.equal(resolveTheme(null, false), "light");
    assert.equal(resolveTheme("invalid", true), "dark");
});

test("the toggle switches both ways", () => {
    assert.equal(nextTheme("light"), "dark");
    assert.equal(nextTheme("dark"), "light");
});

test("pre-paint initialization matches the persisted preference and survives blocked storage", () => {
    const script = readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
    for (const [saved, systemDark, expected, blocked] of [
        ["light", true, "light", false], ["dark", false, "dark", false],
        [null, true, "dark", false], [null, false, "light", false],
        ["invalid", true, "dark", false], [null, true, "dark", true],
    ]) {
        let isDark;
        const root = { dataset: {}, style: {}, classList: { toggle: (name, value) => { assert.equal(name, "dark"); isDark = value; } } };
        vm.runInNewContext(script, {
            window: { localStorage: { getItem: (key) => { assert.equal(key, THEME_STORAGE_KEY); if (blocked) throw Error("Blocked"); return saved; } },
                matchMedia: () => ({ matches: systemDark }) },
            document: { documentElement: root },
        });
        assert.equal(root.dataset.theme, expected);
        assert.equal(root.style.colorScheme, expected);
        assert.equal(isDark, expected === "dark");
    }
});
