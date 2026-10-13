import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/funding.css', import.meta.url), 'utf8');
const component = readFileSync(new URL('../src/components/funding-page.tsx', import.meta.url), 'utf8');

test('positive funding is red and negative funding is green across tables and summaries', () => {
  for (const selector of ['funding-highlight-value', 'funding-rate-cell', 'funding-extreme-value']) {
    assert.match(css, new RegExp(`\\.${selector}\\.is-positive[^{}]*\\{\\s*color:var\\(--lsar-negative\\);`));
    assert.match(css, new RegExp(`\\.${selector}\\.is-negative[^{}]*\\{\\s*color:var\\(--lsar-positive\\);`));
  }
  assert.doesNotMatch(css, /--lsar-(positive|negative)\s*:/);
  assert.match(component, /value > 0 \? 'is-positive' : value < 0 \? 'is-negative' : ''/);
});

test('funding extreme lists keep one full-width entry per row on desktop and mobile', () => {
  const rules = [...css.matchAll(/\.funding-extreme-panel ol\s*\{([^}]*)\}/g)];
  assert.ok(rules.length >= 2);
  for (const rule of rules) assert.match(rule[1], /grid-template-columns:(?:minmax\(0,1fr\)|1fr)\s*;/);
});

test('funding coin cell keeps native table layout with flex content inside it', () => {
  const rule = css.match(/\.funding-coin-cell\s*\{([^}]*)\}/);
  assert.ok(rule);
  assert.doesNotMatch(rule[1], /display\s*:/);
  assert.match(css, /\.funding-coin-content\s*\{[^}]*display:flex/);
  assert.match(component, /<td className="funding-coin-cell">\s*<div className="funding-coin-content">/);
});

test('funding separators belong to complete rows, not individual content heights', () => {
  assert.match(css, /\.funding-table td\s*\{[^}]*display:table-cell;[^}]*border-bottom:0;/);
  assert.match(css, /\.funding-table tbody tr\s*\{[^}]*border-bottom:1px solid var\(--lsar-rule\)/);
  assert.match(css, /\.funding-table tbody tr:last-child\s*\{[^}]*border-bottom:0/);
});
