import assert from 'node:assert/strict';
import test from 'node:test';
import { orderFundingSources } from '../src/lib/funding-source-order.ts';

test('funding sources use pinned venues first, then descending total USD OI', () => {
  const sources = [
    { exchange: 'bitget', openInterestUsd: 90 },
    { exchange: 'gate', openInterestUsd: 1 },
    { exchange: 'aster', openInterestUsd: 150 },
    { exchange: 'okx', openInterestUsd: 2 },
    { exchange: 'bybit', openInterestUsd: 3 },
    { exchange: 'binance', openInterestUsd: 4 },
  ];
  const original = [...sources];
  assert.deepEqual(orderFundingSources(sources).map(source => source.exchange),
    ['binance', 'bybit', 'okx', 'gate', 'aster', 'bitget']);
  assert.deepEqual(sources, original);
});

test('funding ordering handles absent priority venues and tied or invalid OI', () => {
  assert.deepEqual(orderFundingSources([
    { exchange: 'mexc', openInterestUsd: NaN },
    { exchange: 'deribit', openInterestUsd: 30 },
    { exchange: 'aster', openInterestUsd: 30 },
    { exchange: 'okx', openInterestUsd: 0 },
  ]).map(source => source.exchange), ['okx', 'aster', 'deribit', 'mexc']);
});
