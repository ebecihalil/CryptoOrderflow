import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coinPreferenceKey, chartViewKey, readChartPreference, writeChartPreference,
  shiftedChartRange, validChartView,
} from '../src/lib/chart-preferences.js';

test('each coin retains independent indicator parameters, selections and timeframe', () => {
  const btc = coinPreferenceKey('btc', 'bubbleMinValue');
  const eth = coinPreferenceKey('ETH', 'bubbleMinValue');
  assert.equal(readChartPreference(eth, 10000), 10000);
  writeChartPreference(btc, 75000);
  writeChartPreference(eth, 2500);
  writeChartPreference(coinPreferenceKey('BTC', 'timeframe'), '4h');
  writeChartPreference(coinPreferenceKey('ETH', 'timeframe'), '5m');
  writeChartPreference(coinPreferenceKey('BTC', 'indicators'), ['aggressive-bubbles', 'spot-cvd']);
  for (let i = 0; i < 10; i++) {
    assert.equal(readChartPreference(btc, 10000), 75000);
    assert.equal(readChartPreference(eth, 10000), 2500);
    assert.equal(readChartPreference(coinPreferenceKey('BTC', 'timeframe'), '1h'), '4h');
    assert.equal(readChartPreference(coinPreferenceKey('ETH', 'timeframe'), '1h'), '5m');
  }
  assert.deepEqual(readChartPreference(coinPreferenceKey('BTC', 'indicators'), []), ['aggressive-bubbles', 'spot-cvd']);
  assert.deepEqual(readChartPreference(coinPreferenceKey('ETH', 'indicators'), ['liquidity']), ['liquidity']);
});

test('chart views are isolated by asset, price venue and timeframe', () => {
  const key = chartViewKey('BTC', 'bybit', 'BTCUSDT', '4h');
  const view = { from: 250.5, to: 290.5, anchorTime: 1700000000, anchorLogical: 270,
    panes: { price: { weight: 400, autoScale: false, range: { from: 60000, to: 80000 } },
      'spot-cvd': { weight: 150, autoScale: true, range: null } } };
  assert.equal(validChartView(view), true);
  writeChartPreference(key, view);
  assert.deepEqual(readChartPreference(key, null, validChartView), view);
  assert.equal(readChartPreference(chartViewKey('ETH', 'bybit', 'ETHUSDT', '4h'), null, validChartView), null);
  assert.equal(readChartPreference(chartViewKey('BTC', 'okx', 'BTC-USDT-SWAP', '4h'), null, validChartView), null);
  assert.equal(readChartPreference(chartViewKey('BTC', 'bybit', 'BTCUSDT', '5m'), null, validChartView), null);
  assert.deepEqual(shiftedChartRange(view, 260), { from: 240.5, to: 280.5 });
});

test('malformed preferences fall back and blocked storage still supports switching', () => {
  const key = coinPreferenceKey('TEST', 'technicalSettings');
  writeChartPreference(key, { rsiPeriod: 'bad' });
  assert.deepEqual(readChartPreference(key, { rsiPeriod: 14 }), { rsiPeriod: 14 });
  const invalid = { from: 5, to: 1, anchorTime: 1, anchorLogical: 1, panes: {} };
  assert.equal(validChartView(invalid), false);
  assert.equal(validChartView(null), false);
  assert.equal(validChartView({ ...invalid, to: 10, panes: { price: { weight: 0 } } }), false);
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    const blockedKey = coinPreferenceKey('TEST', 'showVolume');
    writeChartPreference(blockedKey, false);
    assert.equal(readChartPreference(blockedKey, true), false);
  } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else delete globalThis.localStorage;
  }
});

test('preferences persist to browser storage and reload when not in memory', () => {
  const values = new Map();
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } });
  try {
    const key = coinPreferenceKey('SOL', 'timeframe');
    writeChartPreference(key, '15m');
    assert.equal(values.get(key), '"15m"');
    const otherKey = coinPreferenceKey('SOL', 'fundingMethod');
    values.set(otherKey, '"weighted"');
    assert.equal(readChartPreference(otherKey, 'mean'), 'weighted');
    values.set(coinPreferenceKey('SOL', 'bad'), '{broken');
    assert.equal(readChartPreference(coinPreferenceKey('SOL', 'bad'), 42), 42);
  } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else delete globalThis.localStorage;
  }
});
