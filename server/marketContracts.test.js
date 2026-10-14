import test from "node:test";
import assert from "node:assert/strict";
import { CHART_VENUES, parseMarketContracts, createMarketContractService } from "./marketContracts.js";

export const metadataFixtures = {
  binance: { symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL" }] },
  bybit: { result: { list: [{ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT", status: "Trading", contractType: "LinearPerpetual" }] } },
  okx: { code: "0", data: [{ instId: "BTC-USDT-SWAP", ctValCcy: "BTC", ctVal: "0.01", state: "live", instType: "SWAP", settleCcy: "USDT" }] },
  gate: [{ name: "BTC_USDT", quanto_multiplier: "0.0001", in_delisting: false }],
  mexc: { success: true, data: [{ symbol: "BTC_USDT", baseCoin: "BTC", quoteCoin: "USDT", state: 0, contractSize: 0.0001 }] },
  bitget: { code: "00000", data: [{ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT", symbolStatus: "normal", symbolType: "perpetual" }] },
  bingx: { code: 0, data: [{ symbol: "BTC-USDT", status: 1 }] },
};

for (const exchange of Object.keys(CHART_VENUES)) {
  test(`${exchange} catalogue preserves native contract and TradingView identity`, () => {
    const [contract] = parseMarketContracts(exchange, metadataFixtures[exchange]);
    assert.equal(contract.asset, "BTC");
    assert.equal(contract.ticker, "BTCUSDT");
    assert.equal(contract.label, `BTCUSDT — ${CHART_VENUES[exchange][1]}`);
    assert.equal(contract.tvExchange, CHART_VENUES[exchange][0]);
  });
}

test("catalogue excludes stocks, expired delivery contracts and inactive markets; bundles remain native", () => {
  const rows = metadataFixtures.binance.symbols;
  const result = parseMarketContracts("binance", { symbols: [...rows,
    { ...rows[0], symbol: "TSLAUSDT", baseAsset: "TSLA" },
    { ...rows[0], symbol: "ETHUSDT_261231", baseAsset: "ETH", contractType: "CURRENT_QUARTER" },
    { ...rows[0], symbol: "ETHUSDT", baseAsset: "ETH", status: "BREAK" },
    { ...rows[0], symbol: "1000PEPEUSDT", baseAsset: "1000PEPE" },
  ] });
  assert.deepEqual(result.map(row => row.asset), ["BTC", "PEPE"]);
  assert.equal(result[1].priceDivisor, 1000);
  assert.equal(result[1].ticker, "1000PEPEUSDT");
  assert.throws(() => parseMarketContracts("okx", { code: "50011", data: [] }), /rejected/);
});

test("coalesced metadata loads are progressive and cached hourly; typing does not refetch upstream", async () => {
  let calls = 0, clock = 1000;
  const service = createMarketContractService({ now: () => clock, request: async url => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 1));
    const exchange = url.includes("bybit") ? "bybit" : url.includes("binance") ? "binance" : url.includes("okx") ? "okx"
      : url.includes("gateio") ? "gate" : url.includes("mexc") ? "mexc" : url.includes("bitget") ? "bitget" : "bingx";
    return metadataFixtures[exchange];
  }, gates: {} });
  const initial = service.get();
  assert.equal(initial.isRefreshing, true);
  service.get(); service.get();
  await service.lookup("bybit", "BTCUSDT");
  await new Promise(resolve => setTimeout(resolve, 8));
  assert.equal(service.get().contracts.length, 7);
  assert.equal(calls, 7);
  for (let i = 0; i < 30; i++) service.get();
  assert.equal(calls, 7);
  clock += 3600001;
  service.get();
  await new Promise(resolve => setTimeout(resolve, 8));
  assert.equal(calls, 14);
});

test("failed metadata retries are held five minutes; unknown contracts never invented", async () => {
  let calls = 0;
  const service = createMarketContractService({ now: () => 1000, request: async () => { calls++; throw Error("private IP error"); }, gates: {} });
  await assert.rejects(service.lookup("gate", "BTC_USDT"), /unavailable/);
  await assert.rejects(service.lookup("gate", "ETH_USDT"), /unavailable/);
  assert.equal(calls, 1);
  assert.equal(service.get().contracts.length, 0);
  assert.ok(!JSON.stringify(service.get()).includes("private"));
  await assert.rejects(service.lookup("__proto__", "BTCUSDT"), /Unsupported/);
});

test("Bybit catalogue pagination is coalesced and cannot loop indefinitely", async () => {
  let calls = 0;
  const service = createMarketContractService({ now: () => 1, gates: {}, request: async url => {
    calls++;
    const first = metadataFixtures.bybit.result.list[0];
    return { result: { list: [{ ...first, symbol: url.includes("cursor") ? "ETHUSDT" : "BTCUSDT",
      baseCoin: url.includes("cursor") ? "ETH" : "BTC" }], nextPageCursor: url.includes("cursor") ? "" : "page2" } };
  } });
  await service.lookup("bybit", "ETHUSDT");
  assert.equal(calls, 2);
});
