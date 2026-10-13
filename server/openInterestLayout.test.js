import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/components/open-interest-page.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/open-interest.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const snapshotHook = readFileSync(new URL('../src/hooks/use-open-interest-snapshot.ts', import.meta.url), 'utf8');

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
    "`Aggregated OI Change (%) · ${timeframe === '24h' ? '24h rolling' : `${timeframe} candle`}`",
    "'Aggregated OI ($)'",
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

test('top rankings stay rolling 24H and the 24H table shares their snapshot and exchange selection', () => {
  assert.match(component, /const dailyQuery = useOpenInterestSnapshot\('24h', selectedExchanges \?\? \[\], 'rolling24h'\);/);
  assert.match(component, /const query = useOpenInterestSnapshot\(timeframe, selectedExchanges \?\? \[\], timeframe === '24h' \? 'rolling24h' : 'candle'\);/);
  assert.match(component, /const tableQuery = timeframe === '24h' \? dailyQuery : query;/);
  assert.match(component, /const snapshot = tableQuery\.data;/);
  assert.match(component, /const loading = tableQuery\.isLoading && !snapshot;/);
  assert.match(component, /const dailySnapshot = dailyQuery\.data;/);
  assert.match(component, /const hasExchangeSelection = selectedExchanges === null \|\| activeExchanges\.length > 0;/);
  assert.match(component, /hasExchangeSelection \? dailySnapshot\?\.extremes\.gainers \?\? \[\] : \[\]/);
  assert.match(component, /hasExchangeSelection \? dailySnapshot\?\.extremes\.losers \?\? \[\] : \[\]/);
  assert.doesNotMatch(component, /snapshot\?\.extremes\.(?:gainers|losers)/);
  assert.match(component, /<ExtremePanel title="Top OI gainers" rows=\{gainers\} kind="gainer" loading=\{dailyLoading\}/);
  assert.match(component, /<ExtremePanel title="Top OI losers" rows=\{losers\} kind="loser" loading=\{dailyLoading\}/);
  assert.match(component, /24H rolling/);
  assert.match(component, /rankingCoverage\.coinsWithHistory\.toLocaleString\(\).*rankingCoverage\.eligibleCoins\.toLocaleString\(\)/);
  assert.match(component, /dailyQuery\.isError/);
  assert.match(component, /onClick=\{\(\) => \{ void dailyQuery\.refetch\(\); \}\}>Retry daily rankings/);
  assert.match(component, /Promise\.all\(\[query\.refetch\(\), dailyQuery\.refetch\(\)\]\)/);
  assert.match(component, /void \(timeframe === '24h'\s*\? dailyQuery\.refetch\(\)\s*: Promise\.all/);
  assert.match(component, /approximately 24 hours earlier, using a 5-minute historical baseline tolerance/);
  assert.match(component, /coins without a usable baseline are excluded/i);
  assert.match(component, /Ranking coverage:/);
});

test('24H table and rankings use identical cached query keys; shorter table TFs stay candle-based', () => {
  assert.match(snapshotHook, /comparison: OiComparison = 'candle'/);
  assert.match(snapshotHook, /queryKey: \['open-interest-snapshot', timeframe, selection, comparison\]/);
  assert.match(snapshotHook, /if \(comparison !== 'candle'\) params\.set\('comparison', comparison\)/);
  assert.match(component, /useOpenInterestSnapshot\(timeframe, selectedExchanges \?\? \[\], timeframe === '24h' \? 'rolling24h' : 'candle'\)/);
  assert.match(component, /useOpenInterestSnapshot\('24h', selectedExchanges \?\? \[\], 'rolling24h'\)/);
});

test('source status, rankings, controls, table, pagination and methodology stay in the requested order', () => {
  const source = component.indexOf('<SourceLine sources={sources} />');
  const rankings = component.indexOf('<section className="oi-extremes"');
  const controls = component.indexOf('<section className="oi-controls"');
  const table = component.indexOf('<div className="oi-table-shell">');
  const pagination = component.indexOf('<nav className="oi-pagination"');
  const footer = component.indexOf('<footer className="oi-footline"');
  const comparisonNote = component.indexOf('<p className="oi-comparison-note">');
  const methodology = component.indexOf('<section className="oi-method"');
  assert.ok(source < rankings);
  assert.ok(rankings < controls && controls < table);
  assert.ok(table < pagination && pagination < footer && footer < comparisonNote && comparisonNote < methodology);
  assert.equal(component.indexOf('<p className="oi-comparison-note">'), comparisonNote);
  assert.equal(component.indexOf('<section className="oi-method"'), methodology);
  assert.match(component, /Retry daily rankings/);
  assert.match(component, /onClick=\{\(\) => \{ void tableQuery\.refetch\(\); \}\}>Retry/);
});

test('OI labels and change tooltips distinguish shared rolling 24H from shorter candles', () => {
  assert.match(component, /24h rolling/);
  assert.match(component, /rolling 24-hour comparison/);
  assert.match(component, /venues matched across both compared candles/);
  assert.match(component, /The 24h table change uses the same rolling 24-hour snapshot/);
  assert.match(component, /!snapshot && tableQuery\.isError/);
});

test('contract size formatting delegates to the shared abbreviated formatter', () => {
  assert.match(component, /import \{ formatOiUnits \} from '@\/lib\/open-interest-format';/);
  assert.match(component, /function formatUnits\(value: number \| null \| undefined, asset: string\) \{\s*return formatOiUnits\(value, asset\);\s*\}/);
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
