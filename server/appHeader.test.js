import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('one header controls the layout of LSAR, Funding and other sections', () => {
  for (const path of ['src/App.tsx', 'src/components/funding-page.tsx', 'src/components/module-pages.tsx']) {
    const source = read(path);
    assert.match(source, /<AppHeader /);
    assert.doesNotMatch(source, /<header|FundingHeader|module-topbar-right|lsar-active-module/);
  }
});

test('header actions always appear in Home, section, feed, theme order', () => {
  const source = read('src/components/app-header.tsx');
  const positions = ['<HomeButton />', 'className="app-header-section"', 'data-testid="status-api-health"', '<ThemeToggle />']
    .map(part => source.indexOf(part));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(source, /subtitle = 'Perpetual Markets'/);
});

test('all header feed indicators use cached app health, not exchange requests', () => {
  const source = read('src/components/app-header.tsx');
  assert.match(source, /queryKey: \['health'\]/);
  assert.match(source, /fetch\('\/api\/healthz', \{ signal \}\)/);
  assert.match(source, /staleTime: 60_000/);
  assert.match(source, /if \(!response.ok\) throw new Error/);
  assert.match(source, /health.isError \? 'API unreachable' : 'Market feed'/);
  assert.doesNotMatch(source, /api\/market|binance\.com|bybit\.com/);
});

test('header appearance and mobile visibility rules are shared across sections', () => {
  const css = read('src/styles/app-header.css');
  assert.match(css, /\.topbar\.app-header/);
  assert.match(css, /padding:16px 4.2vw/);
  assert.match(css, /min-height:82px/);
  assert.match(css, /\.app-header-section \{[^}]*width:190px/);
  assert.match(css, /@media \(max-width:700px\)/);
  assert.match(css, /\.app-header-feed-label/);
  assert.match(css, /\.app-header\.theme-toggle-label|\.app-header \.theme-toggle-label/);
});
