import test from 'node:test';
import assert from 'node:assert/strict';
import { coinLogoTicker, coinLogoUrls, coinLogoUrl } from '../src/lib/coin-logos.ts';
import { buildLogoCatalog } from '../scripts/update-coin-logos.js';
import { exchangeForUrl } from './exchangeHttpClient.js';
import { readFileSync } from 'node:fs';

test('logos resolve major and newer cryptocurrencies by verified identity', () => {
  for (const [symbol, id] of [['BTC', 1], ['HYPE', 32196], ['PEPE', 24478], ['DOGE', 74], ['FARTCOIN', 33597], ['JUP', 29210]]) {
    assert.equal(coinLogoUrl(symbol), `https://s2.coinmarketcap.com/static/img/coins/64x64/${id}.png`);
  }
});

test('exchange-hosted verified images cover small tokens missing the primary catalog', () => {
  for (const symbol of ['ALLINU', 'COOL']) {
    assert.equal(coinLogoUrl(symbol),
      `https://icon.staticimgs.com/images/coin_icon/64/${symbol.toLowerCase()}.png`);
  }
});

test('multiplier names and verified aliases use underlying logos without changing 1INCH', () => {
  for (const symbol of ['100PEPE', '1000PEPE', '10000PEPE', '100000PEPE', 'KPEPE']) {
    assert.equal(coinLogoUrl(symbol), coinLogoUrl('PEPE'), symbol);
  }
  assert.equal(coinLogoUrl('BTCPERP'), coinLogoUrl('BTC'));
  assert.equal(coinLogoUrl('SOLPERP'), coinLogoUrl('SOL'));
  assert.equal(coinLogoUrl('KBONK'), coinLogoUrl('BONK'));
  assert.equal(coinLogoUrl('FILECOIN'), coinLogoUrl('FIL'));
  assert.equal(coinLogoTicker('1INCH'), '1INCH');
});

test('invalid paths, unknown tickers and non-crypto contracts cannot receive unrelated logos', () => {
  for (const value of ['../btc', '', 'https://example.com', 'THISCOINDOESNOTEXIST', 'NATGAS', 'XAU', 'NVDA', 'CRCLSTOCK', 'ETN']) {
    assert.deepEqual(coinLogoUrls(value), [], value);
  }
});

test('duplicate ticker identities are withheld unless verified by name or exchange listing', () => {
  const coin = (id, name, tags = []) => ({ id, name, symbol: 'ABC', isActive: 1, marketPairCount: 2, tags });
  const coins = [coin(100000, 'Alpha'), coin(100001, 'Another token')];
  const uncertain = buildLogoCatalog(coins, []);
  assert.equal(uncertain.logos.ABC, undefined);
  assert.deepEqual(uncertain.ambiguous, ['ABC']);
  assert.equal(buildLogoCatalog(coins, [], [{ symbol: 'ABC', name: 'Alpha' }]).logos.ABC.id, 100000);
  assert.equal(buildLogoCatalog([coins[0], coin(100001, 'Another token', ['binance-listing'])], []).logos.ABC.id, 100001);
  assert.equal(buildLogoCatalog(coins, [], [{ symbol: 'ABC', name: 'Alpha' }, { symbol: 'ABC', name: 'Another token' }]).logos.ABC, undefined);
});

test('inactive or non-traded tokens cannot overwrite active logos; duplicate records are deduplicated', () => {
  const coin = { id: 99999, symbol: 'UNIQUECOIN', name: 'Unique', isActive: 1, marketPairCount: 5 };
  assert.equal(buildLogoCatalog([coin, coin, { ...coin, id: 99998, isActive: 0 }], []).logos.UNIQUECOIN.id, 99999);
});

test('fallback logo hosts are fixed and failed requests advance to another source', () => {
  const urls = coinLogoUrls('BTC');
  assert.ok(urls.length >= 3);
  assert.ok(urls.every(url => ['s2.coinmarketcap.com', 'raw.githubusercontent.com', 'assets.coincap.io', 'icon.staticimgs.com'].includes(new URL(url).hostname)));
  const component = readFileSync(new URL('../src/components/coin-logo.tsx', import.meta.url), 'utf8');
  assert.match(component, /failedLogoUrls\.add\(url\)/);
  assert.match(component, /setAttempt\(\{ asset, index: index \+ 1 \}\)/);
  assert.match(component, /attempt\.asset === asset/);
});

test('exchange identity metadata uses the existing shared exchange request gates', () => {
  assert.equal(exchangeForUrl('https://api2.bybit.com/spot/api/basic/symbol_list_v3'), 'bybit');
  assert.equal(exchangeForUrl('https://api.mexc.com/api/v3/exchangeInfo'), 'mexc');
});
