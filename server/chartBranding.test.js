import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('indicator display names change without changing saved selection identifiers', () => {
  const page = read('src/pages/super-charts-page.tsx');
  for (const [id, label] of [
    ['perpetual-cvd', 'Aggregated Perpetual CVD'],
    ['spot-cvd', 'Aggregated Spot CVD'],
    ['aggressive-bubbles', 'Aggressive Volume Bubbles'],
  ]) assert.ok(page.includes(`id: '${id}', label: '${label}'`));
  for (const file of ['src/components/native-chart-workspace.tsx', 'src/components/native-super-chart.tsx']) {
    assert.ok(read(file).includes('Aggregated Perpetual CVD'));
    assert.ok(read(file).includes('Aggregated Spot CVD'));
  }
  assert.ok(read('src/components/native-chart-workspace.tsx').includes('<h2>Aggressive Volume Bubbles</h2>'));
});

test('the green COF favicon replaces the orange placeholder and bypasses the old cached URL', () => {
  const icon = read('public/favicon.svg');
  assert.match(icon, /fill="#247869"/);
  assert.match(icon, /aria-label="Crypto Order Flow"/);
  assert.match(icon, /<g[^>]*stroke=/);
  assert.doesNotMatch(icon, /#FF3C00/i);
  assert.match(read('index.html'), /href="\/favicon\.svg\?v=cof-green"/);
});
