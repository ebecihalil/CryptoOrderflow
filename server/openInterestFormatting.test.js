import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOiUnits } from '../src/lib/open-interest-format.js';

test('OI contract sizes abbreviate thousands, millions and billions while retaining the coin unit', () => {
  assert.equal(formatOiUnits(1500, 'BTC'), '1.5K BTC');
  assert.equal(formatOiUnits(9876543, 'ETH'), '9.88M ETH');
  assert.equal(formatOiUnits(1540000000, 'PEPE'), '1.54B PEPE');
  assert.equal(formatOiUnits(1e12, 'SHIB'), '1,000B SHIB');
});

test('OI compact quantities preserve small values and promote rounded suffix boundaries', () => {
  assert.equal(formatOiUnits(765.432001, 'BTC'), '765.432001 BTC');
  assert.equal(formatOiUnits(0, 'BTC'), '0 BTC');
  assert.equal(formatOiUnits(999999, 'BTC'), '1M BTC');
  assert.equal(formatOiUnits(999999999, 'PEPE'), '1B PEPE');
});

test('OI compact quantities never turn missing or non-finite data into zero', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '1000']) {
    assert.equal(formatOiUnits(value, 'BTC'), '—');
  }
});
