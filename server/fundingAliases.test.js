import test from 'node:test';
import assert from 'node:assert/strict';
import { fundingReading, buildFundingSnapshot } from './fundingMath.js';

const now = 1_800_000_000_000;
const end = Math.floor(now / 3600_000) * 3600_000;
function reading(exchange, asset, oi, rate = 0.001, symbol = `${asset}USDT`) {
  return { ...fundingReading(exchange, symbol, asset, oi, rate, 8), fetchedAt: now };
}
function snapshot(readings, timeframe = 'current', histories = new Map()) {
  const states = Object.fromEntries([...new Set(readings.map(item => item.exchange))].map(exchange =>
    [exchange, { readings: readings.filter(item => item.exchange === exchange),
      status: 'live', updatedAt: new Date(now).toISOString(), error: null, running: false }]));
  return buildFundingSnapshot(states, histories, timeframe, now);
}

test('all requested multipliers and plain contracts combine into one OI-weighted funding row', () => {
  const readings = ['100PEPE', '1000PEPE', '10000PEPE', '100000PEPE', 'PEPE'].map((asset, index) =>
    reading(['binance', 'bybit', 'okx', 'gate', 'bitget'][index], asset, (index + 1) * 100, (index + 1) * 0.001));
  const result = snapshot(readings);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.asset, 'PEPE');
  assert.equal(row.sourceCount, 5);
  assert.equal(row.aggregateOpenInterestUsd, 1500);
  assert.ok(Math.abs(row.aggregatePct - 550 / 1500) < 1e-12);
  for (const item of readings) {
    assert.equal(row.venues[item.exchange].openInterestUsd, item.oiUsd);
    assert.equal(row.venues[item.exchange].contracts[0].symbol, item.symbol);
    assert.equal(row.venues[item.exchange].nativeRatePct, item.ratePct);
  }
});

test('majority naming counts exchanges, and single-exchange names remain unchanged', () => {
  const rows = snapshot([reading('binance', '1000PEPE', 50), reading('bybit', '1000PEPE', 50), reading('gate', 'PEPE', 900)]).rows;
  assert.equal(rows[0].displayAsset, '1000PEPE');
  for (const asset of ['100PEPE', '1000PEPE', '10000PEPE', '100000PEPE', 'PEPE']) {
    assert.equal(snapshot([reading('bybit', asset, 100)]).rows[0].displayAsset, asset);
  }
});

test('multiple contracts do not get extra name votes and OI breaks name ties exactly like LSAR', () => {
  assert.equal(snapshot([reading('binance', '1000PEPE', 100), reading('bybit', 'PEPE', 400)]).rows[0].displayAsset, 'PEPE');
  const rows = snapshot([
    reading('binance', '1000PEPE', 20, 0.001, '1000PEPEUSDT'),
    reading('binance', '1000PEPE', 20, 0.001, '1000PEPEUSDC'),
    reading('binance', 'PEPE', 30),
    reading('bybit', '1000PEPE', 10),
    reading('gate', 'PEPE', 10),
  ]).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].displayAsset, '1000PEPE');
  assert.equal(rows[0].sourceCount, 3);
});

test('historical funding keeps original contract history keys while combining multiplier aliases', () => {
  const readings = [reading('binance', '1000PEPE', 100), reading('bybit', 'PEPE', 300)];
  const histories = new Map(readings.map((item, index) => [`${item.exchange}:${item.symbol}`, {
    from: end - 86400_000, to: end, complete: true,
    points: [{ timestamp: end - 3600_000, ratePct: index === 0 ? 0.1 : 0.3 }],
  }]));
  const result = snapshot(readings, '1d', histories);
  assert.equal(result.rows.length, 1);
  assert.ok(Math.abs(result.rows[0].aggregatePct - 0.25) < 1e-12);
  assert.equal(result.rows[0].venues.binance.valuePct, 0.1);
  assert.equal(result.rows[0].venues.bybit.valuePct, 0.3);
});

test('ordinary numbered coin names are not accidentally merged and surrounding whitespace is ignored', () => {
  for (const asset of ['1INCH', '2Z', '4', '10X', '100', '123X']) {
    assert.equal(reading('bybit', asset, 100).asset, asset);
  }
  assert.equal(reading('bybit', ' 1000x ', 100).asset, 'X');
  assert.equal(reading('bybit', ' 1000x ', 100).exchangeAsset, '1000X');
});
