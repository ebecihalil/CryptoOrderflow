import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/components/open-interest-page.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/open-interest.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('open interest is routed before and excluded from module placeholders', () => {
  assert.match(app, /import \{ OpenInterestPage \} from '@\/components\/open-interest-page';/);
  assert.match(app, /<Route path="\/open-interest" component=\{OpenInterestPage\} \/>/);
  assert.match(app, /module\.path !== '\/open-interest'/);
  assert.ok(app.indexOf('<Route path="/open-interest"') < app.indexOf('{MODULES.filter'));
});

test('open interest uses the shared header, coin and exchange logos, and the exact six timeframes', () => {
  assert.match(component, /<AppHeader title="Open Interest" mark="OI"/);
  assert.match(component, /<CoinLogo asset=\{row\.asset\}/);
  assert.match(component, /<ExchangeLogo exchange=\{source\.exchange\}/);
  assert.match(component, /const TIMEFRAMES: OiTimeframe\[\] = \['5m', '15m', '30m', '1h', '4h', '24h'\];/);
});

test('OI table columns use the required order and each header is sortable', () => {
  const headings = [...component.matchAll(/\['(?:asset|aggregateOiCoin|changePct|aggregateOiUsd|oiVolumeRatio)',\s*([^\]]+)\]/g)]
    .map((match) => match[1]);
  assert.equal(headings.length, 5);
  assert.deepEqual(headings, [
    "'Coin'",
    "'Aggregated OI Contract Size'",
    "`Aggregated OI Change (%) · ${timeframe}`",
    "'OI in Dollars'",
    "'OI / 24H Volume Ratio'",
  ]);
  assert.match(component, /<SortButton field=\{field\} label=\{label\} active=\{sortField === field\}/);
  assert.match(component, /onClick=\{\(\) => onSort\(field\)\}/);
});

test('positive and negative OI changes use normal positive/negative theme colors', () => {
  assert.match(css, /\.oi-positive\s*\{[^}]*color:var\(--lsar-positive\)/);
  assert.match(css, /\.oi-negative\s*\{[^}]*color:var\(--lsar-negative\)/);
  assert.match(component, /change > 0 \? 'oi-positive' : change < 0 \? 'oi-negative'/);
});

test('an explicitly cleared exchange selection suppresses both global extreme lists', () => {
  assert.match(component, /const hasExchangeSelection = selectedExchanges === null \|\| activeExchanges\.length > 0;/);
  assert.match(component, /hasExchangeSelection \? snapshot\?\.extremes\.gainers \?\? \[\] : \[\]/);
  assert.match(component, /hasExchangeSelection \? snapshot\?\.extremes\.losers \?\? \[\] : \[\]/);
});

test('50-row pagination reports visible ranges and resets after table controls change', () => {
  assert.match(component, /const PAGE_SIZE = 50;/);
  assert.match(component, /const currentPage = Math\.min\(page, pageCount - 1\);/);
  assert.match(component, /rows\.slice\(currentPage \* PAGE_SIZE, \(currentPage \+ 1\) \* PAGE_SIZE\)/);
  assert.match(component, /showing \{currentPage \* PAGE_SIZE \+ 1\}–\{Math\.min\(\(currentPage \+ 1\) \* PAGE_SIZE, rows\.length\)\} of \{rows\.length\} coins/);
  assert.match(component, /if \(field === sortField\) setSortDirection[\s\S]*?setPage\(0\);/);
  assert.match(component, /onClick=\{\(\) => \{ setTimeframe\(value\); setPage\(0\); \}\}/);
  assert.match(component, /onChange=\{\(event\) => \{ setSearch\(event\.target\.value\); setPage\(0\); \}\}/);
  assert.match(component, /onChange=\{\(next\) => \{ setSelectedExchanges\(next\); setPage\(0\); \}\}/);
  assert.match(component, /Page \{currentPage \+ 1\} of \{pageCount\}/);
});

test('null, undefined, and non-finite numeric readings display a dash', () => {
  assert.match(component, /if \(value === null \|\| value === undefined \|\| !Number\.isFinite\(value\)\) return '—';/);
  assert.match(component, /row\.oiVolumeRatio === null \|\| !Number\.isFinite\(row\.oiVolumeRatio\) \? '—'/);
  assert.match(component, /row\.aggregateOiCoin, row\.asset/);
  assert.match(component, /row\.changePct/);
});

test('desktop OI table fits its container without a wide minimum table width', () => {
  assert.match(css, /\.oi-table\s*\{[^}]*width:100%/);
  assert.doesNotMatch(css, /\.oi-table\s*\{[^}]*min-width\s*:/);
  assert.doesNotMatch(css, /\.oi-table-shell\s*\{[^}]*overflow-x\s*:/);
});
