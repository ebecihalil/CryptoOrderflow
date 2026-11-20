import test from "node:test";
import assert from "node:assert/strict";
import { I18N_KEYS, LANGUAGES } from "../src/lib/i18n-keys.js";
import { I18N_TEXT } from "../src/lib/i18n-text.js";

test("every language has exactly one translated line per key", () => {
  assert.equal(new Set(I18N_KEYS).size, I18N_KEYS.length, "duplicate key");
  for (const { code } of LANGUAGES.filter(language => language.code !== "en")) {
    const lines = I18N_TEXT[code]?.split("\n");
    assert.ok(lines, `${code} missing`);
    assert.equal(lines.length, I18N_KEYS.length, `${code} line count`);
    lines.forEach((line, index) => assert.ok(line.trim(), `${code} line ${index + 1} is empty`));
  }
  assert.deepEqual(Object.keys(I18N_TEXT).sort(), LANGUAGES.map(l => l.code).filter(c => c !== "en").sort());
});

test("languages include the requested ones with flags", () => {
  const codes = LANGUAGES.map(l => l.code);
  for (const code of ["en", "tr", "hi", "ru", "el", "zh", "ko", "vi", "id", "pt", "es"]) assert.ok(codes.includes(code), code);
  for (const { flag } of LANGUAGES) assert.match(flag, /^[a-z]{2}$/);
});

test("brand and symbols survive translation", () => {
  const sc = I18N_KEYS.indexOf("Super Charts (Indicators)");
  const tt = I18N_KEYS.indexOf("OI-weighted positioning of top traders on Binance, OKX and Gate.io.");
  for (const [code, text] of Object.entries(I18N_TEXT)) {
    const lines = text.split("\n");
    assert.match(lines[sc], /^Super Charts/, code);
    assert.match(lines[tt], /Binance/, code);
    assert.match(lines[tt], /Gate\.io/, code);
  }
});
