import test from "node:test";
import assert from "node:assert/strict";
import { isStockOrEtfIdentity, buildFinancialIdentityIndex } from "./assetClasses.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import financial from "../src/data/financial-asset-identities.json" with { type: "json" };

test("financial identity classification uses stock/ETF classes, not broad ecosystem substring matches", () => {
    for (const identity of [
        { name: "KLA Corp", tags: ["tokenized-stock"] },
        { name: "iShares Semiconductor Tokenized ETF (Robinhood)", tags: ["robinhood-stock"] },
        { name: "USA Rare Earth Inc (Derivatives)", tags: ["tokenized-assets"] },
        { name: "Apple xStock", tags: ["tokenized-assets"] },
        { name: "Invesco DB Commodity Index Tokenized Fund (Ondo)", tags: ["tokenized-assets"] },
    ]) assert.equal(isStockOrEtfIdentity(identity), true);
    for (const identity of [
        { name: "Bitcoin", tags: ["rootstock-rsk-ecosystem", "sec-cftc-digital-commodities"] },
        { name: "Ondo", tags: ["real-world-assets-protocols", "tokenized-assets"] },
        { name: "Pepe", tags: ["stock-memes"] },
    ]) assert.equal(isStockOrEtfIdentity(identity), false);
});
test("financial metadata retains stock identities without blocking unrelated crypto with the same ticker", () => {
    assert.deepEqual(buildFinancialIdentityIndex([
        { id: 2, name: "Bitcoin", tags: [] }, { id: 1, name: "Bitcoin Tokenized ETF", tags: [] },
        { id: 1, name: "Bitcoin Tokenized ETF", tags: [] },
    ]).ids, [1]);
    for (const ticker of ["USAR", "KLAC", "SOXX", "DBCON", "KLACPERP", "1000USAR"]) assert.equal(isCryptoAsset(ticker), false, ticker);
    for (const ticker of ["BTC", "ETH", "ONDO", "PEPE"]) assert.equal(isCryptoAsset(ticker), true, ticker);
});
test("shipped financial identity index is unique, sorted, validated and has source provenance", () => {
    assert.ok(financial.source.startsWith("https://"));
    assert.ok(financial.ids.length > 1000);
    assert.deepEqual([...new Set(financial.ids)].sort((a, b) => a - b), financial.ids);
    assert.ok(financial.ids.every(id => Number.isSafeInteger(id) && id > 0));
});
