import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const component = read('src/components/exchange-logo.tsx');
const sources = JSON.parse(read('public/exchanges/sources.json'));

test('all supported Funding and LSAR exchanges have real local logo images', () => {
  const exchanges = ['binance', 'bybit', 'okx', 'gate', 'bitget', 'toobit',
    'mexc', 'kucoin', 'kraken', 'bingx', 'hyperliquid', 'htx', 'deribit', 'aster'];
  for (const exchange of exchanges) {
    const match = component.match(new RegExp(`${exchange}: '(\\/exchanges\\/[^']+)'`));
    assert.ok(match, `Missing logo for ${exchange}`);
    const data = readFileSync(new URL(`../public${match[1]}`, import.meta.url));
    assert.ok(data.length > 100, `Empty logo for ${exchange}`);
    const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = data[0] === 255 && data[1] === 216;
    assert.ok(png || jpeg, `Invalid logo for ${exchange}`);
    assert.match(sources[exchange], /^https:\/\/coin-images\.coingecko\.com\/markets\/images\//);
  }
});

test('Funding sortable exchange headers include shared exchange logos', () => {
  const source = read('src/components/funding-page.tsx');
  assert.match(source, /field=\{exchange\} exchange=\{exchange\} label=\{exchangeLabel\(exchange\)\}/);
  assert.match(source, /className="funding-exchange-title"><ExchangeLogo exchange=\{exchange\} \/><span>\{label\}<\/span>/);
  assert.match(source, /<ExchangeLogo exchange=\{item\.exchange\} \/>/);
  assert.doesNotMatch(source, /ExchangeMark/);
  assert.match(read('src/styles/funding.css'), /\.funding-sort-button \.exchange-logo/);
});
