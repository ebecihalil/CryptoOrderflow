import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { underlyingPrice } from "./openInterestMath.js";

// Verified standard and Micro contract units. Never add raw contract counts across products.
export const CME_PRODUCTS = {
    BTC: ["BTC", 5], MBT: ["BTC", 0.1], ETH: ["ETH", 50], MET: ["ETH", 0.1],
    SOL: ["SOL", 500], MSL: ["SOL", 25], XRP: ["XRP", 50000], MXP: ["XRP", 2500],
    ADA: ["ADA", 100000], MCA: ["ADA", 10000], LNK: ["LINK", 5000], MLN: ["LINK", 250],
    XLM: ["XLM", 250000], MXL: ["XLM", 12500],
};
export function validateCmeReport(report, now = Date.now()) {
    if (!report || !Array.isArray(report.records) || report.records.length > 1000)
        throw new Error("CME report must contain at most 1,000 records");
    if (!/^https:\/\/[^/]+\/.+/.test(report.sourceUrl ?? "")) throw new Error("CME report needs its authorized source URL");
    const source = new URL(report.sourceUrl);
    if (source.username || source.password || [...source.searchParams.keys()].some(key => /key|token|secret|password|signature/i.test(key)))
        throw new Error("CME source URL must be a public reference, without credentials");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(report.reportDate ?? "")) throw new Error("CME reportDate must be YYYY-MM-DD");
    const date = Date.parse(`${report.reportDate}T00:00:00Z`);
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== report.reportDate || date > now)
        throw new Error("Invalid or future CME report date");
    const seen = new Set();
    const records = report.records.map(record => {
        const product = CME_PRODUCTS[record.productCode];
        if (!product) throw new Error(`Unverified CME product ${record.productCode}`);
        if (!record.contract || typeof record.contract !== "string" || record.contract.length > 80)
            throw new Error("CME records need a unique contract identifier, or ALL for a product total");
        const key = `${record.productCode}:${record.contract}`;
        if (seen.has(key)) throw new Error("Duplicate CME contract would double-count OI");
        seen.add(key);
        if (typeof record.openInterestContracts !== "number" || !Number.isSafeInteger(record.openInterestContracts) || record.openInterestContracts < 0)
            throw new Error("CME open interest must be a non-negative integer number of contracts");
        return { ...record, asset: product[0], oiCoin: record.openInterestContracts * product[1] };
    });
    for (const code of new Set(report.records.map(record => record.productCode)))
        if (records.some(record => record.productCode === code && record.contract === "ALL") &&
            records.filter(record => record.productCode === code).length > 1)
            throw new Error("Do not combine a CME product total with its expiry rows");
    return { ...report, records };
}
const file = fileURLToPath(new URL("../data/cme-daily.json", import.meta.url));
let checkedAt = 0, mtime = null, cached = null, loadError = null;
export function getCmeState(inventory, now = Date.now()) {
    if (now - checkedAt > 60_000) {
        checkedAt = now;
        try {
            const modified = statSync(file).mtimeMs;
            if (modified !== mtime) { cached = validateCmeReport(JSON.parse(readFileSync(file, "utf8")), now); mtime = modified; }
            loadError = null;
        } catch (error) {
            cached = null;
            loadError = error.code === "ENOENT" ? "CME needs an authorized daily report/feed; automated website scraping is prohibited." : error.message;
        }
    }
    if (!cached || now - Date.parse(`${cached.reportDate}T00:00:00Z`) > 7 * 86400_000)
        return { readings: [], status: "error", running: false, updatedAt: null,
            error: loadError ?? "CME report is more than seven days old; excluded until updated." };
    const reference = new Map();
    for (const item of Object.values(inventory).flatMap(state => state.readings)) {
        const price = underlyingPrice(item);
        if (price > 0 && now - item.fetchedAt <= 900_000 && (!reference.has(item.asset) || reference.get(item.asset).oiUsd < item.oiUsd))
            reference.set(item.asset, { price, oiUsd: item.oiUsd });
    }
    const readings = cached.records.filter(record => record.oiCoin > 0 && reference.has(record.asset)).map(record => ({
        exchange: "cme", symbol: `${record.productCode}:${record.contract}`, asset: record.asset, exchangeAsset: record.asset,
        oiCoin: record.oiCoin, oiUsd: record.oiCoin * reference.get(record.asset).price,
        markPrice: reference.get(record.asset).price, volume24hUsd: null, reportDate: cached.reportDate, fetchedAt: now,
    }));
    return { readings, status: readings.length ? "live" : "delayed", running: false, updatedAt: `${cached.reportDate}T00:00:00Z`,
        error: readings.length < cached.records.length ? "Some CME products have no current verified USD mark price." : null };
}
