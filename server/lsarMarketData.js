const logger = {
    info(details, message) {
        console.info(message, details);
    },
    error(details, message) {
        console.error(message, details);
    },
};
const BINANCE_BASE = "https://fapi.binance.com";
const BINANCE_COINM_BASE = "https://dapi.binance.com";
const BYBIT_BASE = "https://api.bybit.com";
const OKX_BASE = "https://www.okx.com";
const GATE_BASE = "https://api.gateio.ws/api/v4";
const BITGET_BASE = "https://api.bitget.com";
const TOOBIT_BASE = "https://api.toobit.com";
const REFRESH_INTERVAL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const HISTORY_LIMIT = 300;
const WINDOWS = [
    { timeframe: "5m", ms: 5 * 60_000 },
    { timeframe: "15m", ms: 15 * 60_000 },
    { timeframe: "30m", ms: 30 * 60_000 },
    { timeframe: "1h", ms: 60 * 60_000 },
    { timeframe: "4h", ms: 4 * 60 * 60_000 },
    { timeframe: "24h", ms: 24 * 60 * 60_000 },
];
const exchangeStates = {
    binance: { status: "connecting", marketCount: 0, updatedAt: null, error: null },
    bybit: { status: "connecting", marketCount: 0, updatedAt: null, error: null },
    okx: { status: "connecting", marketCount: 0, updatedAt: null, error: null },
    gate: { status: "connecting", marketCount: 0, updatedAt: null, error: null },
    bitget: { status: "connecting", marketCount: 0, updatedAt: null, error: null },
    toobit: { status: "connecting", marketCount: 0, updatedAt: null, error: null },
};
const sourceReadings = {
    binance: [],
    bybit: [],
    okx: [],
    gate: [],
    bitget: [],
    toobit: [],
};
const activeProviderTasks = new Map();
const lastProviderAttempts = new Map();
let nextBybitRequestAt = 0;
const nextRequestAt = {};
let lastPartialPublishAt = 0;
let cachedSnapshot = {
    generatedAt: null,
    isRefreshing: false,
    totalMarkets: 0,
    coverage: { binance: 0, bybit: 0, both: 0, binanceOnly: 0, bybitOnly: 0 },
    sources: Object.keys(exchangeStates).map(makeSourceStatus),
    rows: [],
};
function finiteNumber(value) {
    if (value === undefined)
        return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function isoDate(timestamp) {
    return timestamp && Number.isFinite(timestamp) ? new Date(timestamp) : null;
}
export function canonicalAsset(base) {
    base = base.trim().toUpperCase();
    const letterMultiplier = base.match(/^1([KM])([A-Z].*)$/i);
    if (letterMultiplier) {
        const multiplier = letterMultiplier[1].toUpperCase() === "M" ? 1_000_000 : 1_000;
        return { asset: letterMultiplier[2], priceDivisor: multiplier };
    }
    const match = base.match(/^(10{2,})([A-Z].*)$/i);
    if (!match)
        return { asset: base, priceDivisor: 1 };
    const multiplier = Number(match[1]);
    return Number.isSafeInteger(multiplier) ? { asset: match[2], priceDivisor: multiplier } : { asset: base, priceDivisor: 1 };
}
async function fetchJson(url) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const spacing = url.includes("bitget.com/api/v2/mix/market/account-long-short") ? 1050
                : url.startsWith(OKX_BASE) ? 450 : url.startsWith(GATE_BASE) ? 120
                : url.startsWith(TOOBIT_BASE) ? 150 : 0;
            if (spacing) {
                const key = new URL(url).hostname;
                const scheduled = Math.max(Date.now(), nextRequestAt[key] ?? 0);
                nextRequestAt[key] = scheduled + spacing;
                await new Promise((resolve) => setTimeout(resolve, Math.max(0, scheduled - Date.now())));
            }
            if (url.startsWith(BYBIT_BASE)) {
                const now = Date.now();
                const requestAt = Math.max(now, nextBybitRequestAt);
                nextBybitRequestAt = requestAt + 120;
                if (requestAt > now) {
                    await new Promise((resolve) => setTimeout(resolve, requestAt - now));
                }
            }
            const response = await fetch(url, {
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: { "User-Agent": "Perpetual-LSAR-Screener/1.0" },
            });
            if (!response.ok) {
                const message = `Exchange returned HTTP ${response.status}`;
                if (response.status === 429 || response.status >= 500) {
                    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
                    lastError = new Error(message);
                    continue;
                }
                throw new Error(message);
            }
            const body = (await response.json());
            if (body.code !== undefined && !["0", "00000"].includes(String(body.code))) {
                throw new Error(body.msg || `Exchange error ${body.code}`);
            }
            if (typeof body.retCode === "number" && body.retCode !== 0) {
                const message = body.retMsg || `Exchange error ${body.retCode}`;
                if (body.retCode === 10006 || body.retCode === 10016) {
                    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
                    lastError = new Error(message);
                    continue;
                }
                throw new Error(message);
            }
            return body;
        }
        catch (error) {
            lastError = error;
            if (attempt < 2 && error instanceof Error && error.name === "TimeoutError") {
                await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
                continue;
            }
            if (attempt < 2 && error instanceof TypeError) {
                await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
                continue;
            }
            if (attempt === 2)
                break;
            if (!(error instanceof Error) || !error.message.startsWith("Exchange returned HTTP"))
                break;
        }
    }
    throw lastError instanceof Error ? lastError : new Error("Exchange request failed");
}
async function mapLimit(values, limit, work) {
    const results = new Array(values.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
        while (cursor < values.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await work(values[index]);
        }
    });
    await Promise.all(workers);
    return results;
}
function parseBinanceHistory(items) {
    return items
        .map((item) => ({
        timestamp: item.timestamp,
        ratio: finiteNumber(item.longShortRatio) ?? 0,
    }))
        .filter((item) => item.timestamp > 0 && item.ratio > 0)
        .sort((a, b) => a.timestamp - b.timestamp);
}
function parseBybitHistory(items) {
    return items
        .map((item) => {
        const long = finiteNumber(item.buyRatio);
        const short = finiteNumber(item.sellRatio);
        return {
            timestamp: Number(item.timestamp),
            ratio: long !== null && short !== null && short > 0 ? long / short : 0,
        };
    })
        .filter((item) => item.timestamp > 0 && item.ratio > 0)
        .sort((a, b) => a.timestamp - b.timestamp);
}
function parseRatioHistory(items, timestampField, ratioField) {
    return items.map((item) => ({
        timestamp: Number(item[timestampField]),
        ratio: finiteNumber(item[ratioField]) ?? 0,
    })).filter((item) => item.timestamp > 0 && item.ratio > 0)
        .sort((a, b) => a.timestamp - b.timestamp);
}
function publishReading(reading) {
    if (!reading?.points?.length) return;
    const retained = sourceReadings[reading.exchange].filter((item) => item.symbol !== reading.symbol);
    sourceReadings[reading.exchange] = [...retained, reading];
    if (Date.now() - lastPartialPublishAt >= 5000) {
        lastPartialPublishAt = Date.now();
        publishSnapshot();
    }
}
async function fetchOkx() {
    const [instrumentsBody, openInterestBody, tickerBody] = await Promise.all([
        fetchJson(`${OKX_BASE}/api/v5/public/instruments?instType=SWAP`),
        fetchJson(`${OKX_BASE}/api/v5/public/open-interest?instType=SWAP`),
        fetchJson(`${OKX_BASE}/api/v5/market/tickers?instType=SWAP`),
    ]);
    const instruments = instrumentsBody.data.filter((item) => item.state === "live");
    const oi = new Map(openInterestBody.data.map((item) => [item.instId, finiteNumber(item.oiUsd)]));
    const prices = new Map(tickerBody.data.map((item) => [item.instId, finiteNumber(item.last)]));
    let errorCount = 0;
    const readings = await mapLimit(instruments, 6, async (instrument) => {
        const openInterestUsd = oi.get(instrument.instId);
        const price = prices.get(instrument.instId);
        if (!(openInterestUsd > 0) || !(price > 0)) return null;
        try {
            const url = `${OKX_BASE}/api/v5/rubik/stat/contracts/long-short-account-ratio-contract?instId=${encodeURIComponent(instrument.instId)}`;
            const [history, hourly] = await Promise.all([fetchJson(`${url}&period=5m`), fetchJson(`${url}&period=1H`)]);
            const parse = (body) => body.data.map(([timestamp, ratio]) => ({ timestamp: Number(timestamp), ratio: finiteNumber(ratio) ?? 0 }))
                .filter((item) => item.timestamp > 0 && item.ratio > 0).sort((a, b) => a.timestamp - b.timestamp);
            const normalized = canonicalAsset(instrument.instId.split("-")[0]);
            const reading = { exchange: "okx", symbol: instrument.instId, asset: normalized.asset, exchangeAsset: instrument.instId.split("-")[0],
                price: price / normalized.priceDivisor, priceChange24hPct: null, openInterestUsd,
                points: parse(history), longWindowPoints: parse(hourly) };
            publishReading(reading);
            return reading;
        } catch { errorCount += 1; return null; }
    });
    return { readings: readings.filter(Boolean), marketCount: instruments.length, errorCount, error: null };
}
async function fetchGate() {
    const [contractsBody, tickersBody] = await Promise.all([
        fetchJson(`${GATE_BASE}/futures/usdt/contracts`), fetchJson(`${GATE_BASE}/futures/usdt/tickers`),
    ]);
    const tickers = new Map(tickersBody.map((item) => [item.contract, item]));
    const contracts = contractsBody.filter((item) => item.in_delisting !== true && tickers.has(item.name));
    let errorCount = 0;
    const readings = await mapLimit(contracts, 8, async (contract) => {
        const ticker = tickers.get(contract.name);
        const price = finiteNumber(ticker?.last);
        if (!price) return null;
        try {
            const stats = await fetchJson(`${GATE_BASE}/futures/usdt/contract_stats?contract=${encodeURIComponent(contract.name)}&interval=5m&limit=${HISTORY_LIMIT}`);
            const points = stats.map((item) => ({ timestamp: Number(item.time) * 1000, ratio: finiteNumber(item.lsr_account) ?? 0 }))
                .filter((item) => item.timestamp > 0 && item.ratio > 0).sort((a, b) => a.timestamp - b.timestamp);
            const latest = stats.at(-1);
            const openInterestUsd = finiteNumber(latest?.open_interest_usd);
            const normalized = canonicalAsset(contract.name.split("_")[0]);
            const reading = openInterestUsd > 0 ? { exchange: "gate", symbol: contract.name, asset: normalized.asset, exchangeAsset: contract.name.split("_")[0], price: price / normalized.priceDivisor,
                priceChange24hPct: null, openInterestUsd, points } : null;
            publishReading(reading);
            return reading;
        } catch { errorCount += 1; return null; }
    });
    return { readings: readings.filter(Boolean), marketCount: contracts.length, errorCount, error: null };
}
async function fetchBitget() {
    const [contractsBody, tickersBody] = await Promise.all([
        fetchJson(`${BITGET_BASE}/api/v2/mix/market/contracts?productType=USDT-FUTURES`),
        fetchJson(`${BITGET_BASE}/api/v2/mix/market/tickers?productType=USDT-FUTURES`),
    ]);
    const tickers = new Map(tickersBody.data.map((item) => [item.symbol, item]));
    const contracts = contractsBody.data.filter((item) => item.symbolStatus === "normal" && item.symbolType === "perpetual" && tickers.has(item.symbol))
        .sort((a, b) => Number(tickers.get(b.symbol).holdingAmount) * Number(tickers.get(b.symbol).lastPr)
            - Number(tickers.get(a.symbol).holdingAmount) * Number(tickers.get(a.symbol).lastPr));
    let errorCount = 0;
    const readings = await mapLimit(contracts, 6, async (contract) => {
        const ticker = tickers.get(contract.symbol);
        const price = finiteNumber(ticker?.lastPr);
        const oiUsd = finiteNumber(ticker?.holdingAmount) * price;
        if (!price || !oiUsd || !Number.isFinite(oiUsd)) return null;
        try {
            const historyUrl = `${BITGET_BASE}/api/v2/mix/market/account-long-short?symbol=${encodeURIComponent(contract.symbol)}&productType=USDT-FUTURES`;
            const [history, hourly] = await Promise.all([
                fetchJson(`${historyUrl}&period=5m`), fetchJson(`${historyUrl}&period=1h`),
            ]);
            const normalized = canonicalAsset(contract.baseCoin);
            const reading = { exchange: "bitget", symbol: contract.symbol, asset: normalized.asset, exchangeAsset: contract.baseCoin, price: price / normalized.priceDivisor,
                priceChange24hPct: null, openInterestUsd: oiUsd, points: parseRatioHistory(history.data, "ts", "longShortAccountRatio"),
                longWindowPoints: parseRatioHistory(hourly.data, "ts", "longShortAccountRatio") };
            publishReading(reading);
            return reading;
        } catch { errorCount += 1; return null; }
    });
    return { readings: readings.filter(Boolean), marketCount: contracts.length, errorCount, error: null };
}
export function buildToobitReading(contract, ticker, interest, history) {
    const price = finiteNumber(ticker?.c);
    // Toobit's openInterest.size is coin quantity, not contract count.
    // Convert with the quoted price before normalizing multiplier aliases.
    const quantity = finiteNumber(interest?.openInterestList?.find((item) => item.symbol === contract.symbol)?.size);
    const openInterestUsd = quantity * price;
    const points = Array.isArray(history) ? parseRatioHistory(history, "timeStamp", "longShortRatio") : [];
    if (!(price > 0) || !(quantity > 0) || !Number.isFinite(openInterestUsd) || !points.length) return null;
    const exchangeAsset = contract.symbol.split("-SWAP-")[0];
    const normalized = canonicalAsset(exchangeAsset);
    const change = finiteNumber(ticker.pcp);
    return {
        exchange: "toobit", symbol: contract.symbol, asset: normalized.asset, exchangeAsset,
        price: price / normalized.priceDivisor,
        priceChange24hPct: change === null ? null : change * 100,
        openInterestUsd, points,
    };
}
export async function fetchToobit({ request = fetchJson, onReading = publishReading } = {}) {
    const [info, tickerBody] = await Promise.all([
        request(`${TOOBIT_BASE}/api/v1/exchangeInfo`),
        request(`${TOOBIT_BASE}/quote/v1/contract/ticker/24hr`),
    ]);
    if (!Array.isArray(info.contracts) || !Array.isArray(tickerBody)) throw new Error("Toobit returned invalid contract metadata or tickers.");
    const tickers = new Map(tickerBody.map((item) => [item.s, item]));
    const contracts = info.contracts.filter((item) => item.status === "TRADING"
        && item.quoteAsset === "USDT" && item.inverse !== true
        && item.symbol.endsWith("-SWAP-USDT") && tickers.has(item.symbol))
        .sort((a, b) => (finiteNumber(tickers.get(b.symbol).qv) ?? 0) - (finiteNumber(tickers.get(a.symbol).qv) ?? 0));
    let errorCount = 0;
    const readings = await mapLimit(contracts, 6, async (contract) => {
        const symbol = encodeURIComponent(contract.symbol);
        try {
            const [history, interest] = await Promise.all([
                request(`${TOOBIT_BASE}/quote/v1/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=${HISTORY_LIMIT}`),
                request(`${TOOBIT_BASE}/quote/v1/openInterest?symbol=${symbol}`),
            ]);
            const reading = buildToobitReading(contract, tickers.get(contract.symbol), interest, history);
            if (!reading) { errorCount += 1; return null; }
            onReading(reading);
            return reading;
        } catch { errorCount += 1; return null; }
    });
    return { readings: readings.filter(Boolean), marketCount: contracts.length, errorCount, error: null };
}
async function fetchBinanceLinear() {
    const [info, priceTickers, dayTickers] = await Promise.all([
        fetchJson(`${BINANCE_BASE}/fapi/v1/exchangeInfo`),
        fetchJson(`${BINANCE_BASE}/fapi/v1/ticker/price`),
        fetchJson(`${BINANCE_BASE}/fapi/v1/ticker/24hr`),
    ]);
    const prices = new Map(priceTickers.map((ticker) => [ticker.symbol, finiteNumber(ticker.price)]));
    const changes = new Map(dayTickers.map((ticker) => [ticker.symbol, finiteNumber(ticker.priceChangePercent)]));
    const contracts = info.symbols.filter((contract) => contract.contractType === "PERPETUAL" &&
        contract.status === "TRADING" &&
        (contract.quoteAsset === "USDT" || contract.quoteAsset === "USDC"));
    let errorCount = 0;
    const readings = await mapLimit(contracts, 8, async (contract) => {
        const price = prices.get(contract.symbol);
        if (price == null || price <= 0) {
            errorCount += 1;
            return null;
        }
        try {
            const [history, oi] = await Promise.all([
                fetchJson(`${BINANCE_BASE}/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(contract.symbol)}&period=5m&limit=${HISTORY_LIMIT}`),
                fetchJson(`${BINANCE_BASE}/fapi/v1/openInterest?symbol=${encodeURIComponent(contract.symbol)}`),
            ]);
            const openInterest = finiteNumber(oi.openInterest);
            if (openInterest == null || openInterest <= 0)
                return null;
            const normalized = canonicalAsset(contract.baseAsset);
            return {
                exchange: "binance",
                symbol: contract.symbol,
                asset: normalized.asset,
                exchangeAsset: contract.baseAsset,
                price: price / normalized.priceDivisor,
                priceChange24hPct: changes.get(contract.symbol) ?? null,
                openInterestUsd: openInterest * price,
                points: parseBinanceHistory(history),
            };
        }
        catch {
            errorCount += 1;
            return null;
        }
    });
    return {
        readings: readings.filter((reading) => reading !== null),
        marketCount: contracts.length,
        errorCount,
        error: null,
    };
}
async function fetchBinanceCoinM() {
    const [info, priceTickers, dayTickers] = await Promise.all([
        fetchJson(`${BINANCE_COINM_BASE}/dapi/v1/exchangeInfo`),
        fetchJson(`${BINANCE_COINM_BASE}/dapi/v1/ticker/price`),
        fetchJson(`${BINANCE_COINM_BASE}/dapi/v1/ticker/24hr`),
    ]);
    const prices = new Map(priceTickers.map((ticker) => [ticker.symbol, finiteNumber(ticker.price)]));
    const changes = new Map(dayTickers.map((ticker) => [ticker.symbol, finiteNumber(ticker.priceChangePercent)]));
    const contracts = info.symbols.filter((contract) => contract.contractType === "PERPETUAL" &&
        contract.contractStatus === "TRADING" &&
        Number.isFinite(finiteNumber(contract.contractSize)) &&
        (finiteNumber(contract.contractSize) ?? 0) > 0);
    let errorCount = 0;
    const readings = await mapLimit(contracts, 8, async (contract) => {
        const price = prices.get(contract.symbol);
        if (price == null || price <= 0) {
            errorCount += 1;
            return null;
        }
        try {
            const [history, oi] = await Promise.all([
                fetchJson(`${BINANCE_COINM_BASE}/futures/data/globalLongShortAccountRatio?pair=${encodeURIComponent(contract.pair)}&contractType=PERPETUAL&period=5m&limit=${HISTORY_LIMIT}`),
                fetchJson(`${BINANCE_COINM_BASE}/dapi/v1/openInterest?symbol=${encodeURIComponent(contract.symbol)}`),
            ]);
            const openInterest = finiteNumber(oi.openInterest);
            const contractSize = finiteNumber(contract.contractSize);
            if (openInterest == null || openInterest <= 0 || contractSize == null)
                return null;
            const normalized = canonicalAsset(contract.baseAsset);
            return {
                exchange: "binance",
                symbol: contract.symbol,
                asset: normalized.asset,
                exchangeAsset: contract.baseAsset,
                price: price / normalized.priceDivisor,
                priceChange24hPct: changes.get(contract.symbol) ?? null,
                openInterestUsd: openInterest * contractSize,
                points: parseBinanceHistory(history),
            };
        }
        catch {
            errorCount += 1;
            return null;
        }
    });
    return {
        readings: readings.filter((reading) => reading !== null),
        marketCount: contracts.length,
        errorCount,
        error: null,
    };
}
async function combineExchangeFetches(promises, exchange) {
    const results = await Promise.allSettled(promises);
    const fulfilled = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const failures = results.filter((result) => result.status === "rejected");
    if (fulfilled.length === 0) {
        const firstFailure = failures[0];
        throw firstFailure?.status === "rejected" && firstFailure.reason instanceof Error
            ? firstFailure.reason
            : new Error(`${exchange} product feeds are unavailable`);
    }
    return {
        readings: fulfilled.flatMap((result) => result.readings),
        marketCount: fulfilled.reduce((sum, result) => sum + result.marketCount, 0),
        errorCount: fulfilled.reduce((sum, result) => sum + result.errorCount, 0) + failures.length,
        error: failures.length ? `${failures.length} product feed(s) could not be loaded.` : null,
    };
}
async function fetchBinance() {
    return combineExchangeFetches([fetchBinanceLinear(), fetchBinanceCoinM()], "binance");
}
async function getBybitContracts(category) {
    const contracts = [];
    let cursor = "";
    for (let page = 0; page < 10; page += 1) {
        const query = new URLSearchParams({ category, limit: "1000" });
        if (cursor)
            query.set("cursor", cursor);
        const response = await fetchJson(`${BYBIT_BASE}/v5/market/instruments-info?${query}`);
        contracts.push(...response.result.list);
        const next = response.result.nextPageCursor;
        if (!next || next === cursor)
            break;
        cursor = next;
    }
    return contracts.filter((contract) => contract.status === "Trading" &&
        contract.contractType === (category === "linear" ? "LinearPerpetual" : "InversePerpetual") &&
        (category === "inverse" ||
            contract.quoteCoin === "USDT" ||
            contract.quoteCoin === "USDC"));
}
async function fetchBybitCategory(category) {
    const [allContracts, allTickers] = await Promise.all([
        getBybitContracts(category),
        fetchJson(`${BYBIT_BASE}/v5/market/tickers?category=${category}`),
    ]);
    const tickers = new Map(allTickers.result.list.map((ticker) => [ticker.symbol, ticker]));
    let errorCount = 0;
    const readings = await mapLimit(allContracts, 6, async (contract) => {
        const ticker = tickers.get(contract.symbol);
        const priceValue = finiteNumber(ticker?.lastPrice);
        const oiUsd = finiteNumber(ticker?.openInterestValue);
        if (ticker == null || priceValue == null || priceValue <= 0 || oiUsd == null || oiUsd <= 0) {
            errorCount += 1;
            return null;
        }
        try {
            const history = await fetchJson(`${BYBIT_BASE}/v5/market/account-ratio?category=${category}&symbol=${encodeURIComponent(contract.symbol)}&period=5min&limit=${HISTORY_LIMIT}`);
            const normalized = canonicalAsset(contract.baseCoin);
            const change = finiteNumber(ticker.price24hPcnt);
            return {
                exchange: "bybit",
                symbol: contract.symbol,
                asset: normalized.asset,
                exchangeAsset: contract.baseCoin,
                price: priceValue / normalized.priceDivisor,
                priceChange24hPct: change === null ? null : change * 100,
                openInterestUsd: category === "inverse" ? oiUsd * priceValue : oiUsd,
                points: parseBybitHistory(history.result.list),
            };
        }
        catch {
            errorCount += 1;
            return null;
        }
    });
    return {
        readings: readings.filter((reading) => reading !== null),
        marketCount: allContracts.length,
        errorCount,
        error: null,
    };
}
async function fetchBybit() {
    return combineExchangeFetches([fetchBybitCategory("linear"), fetchBybitCategory("inverse")], "bybit");
}
function weightedRatio(items) {
    const usable = items.filter((item) => Number.isFinite(item.ratio) && item.ratio > 0 && Number.isFinite(item.weight) && item.weight > 0);
    const totalWeight = usable.reduce((total, item) => total + item.weight, 0);
    return totalWeight > 0
        ? usable.reduce((total, item) => total + item.ratio * item.weight, 0) / totalWeight
        : null;
}
function ratioToLongPct(ratio) {
    return ratio === null ? null : (ratio / (1 + ratio)) * 100;
}
function latestPointInBar(points, barStart, barEnd) {
    let latest;
    for (const point of points) {
        if (point.timestamp >= barEnd)
            break;
        if (point.timestamp >= barStart)
            latest = point;
    }
    return latest;
}
export function buildChange(timeframe, duration, readings) {
    const latestTimestamp = Math.max(0, ...readings.map((reading) => reading.points.at(-1)?.timestamp ?? 0));
    const currentBarStart = Math.floor(latestTimestamp / duration) * duration;
    const currentSamples = readings.flatMap((reading) => {
        const latest = reading.points[reading.points.length - 1];
        if (!latest)
            return [];
        const current = latestPointInBar(reading.points, currentBarStart, currentBarStart + duration);
        const previous = latestPointInBar(reading.points, currentBarStart - duration, currentBarStart)
            ?? (duration >= 4 * 60 * 60_000 && reading.longWindowPoints
                ? latestPointInBar(reading.longWindowPoints, currentBarStart - duration, currentBarStart) : undefined);
        if (!current || !previous) return [];
        return [{
                exchange: reading.exchange,
                ratio: current.ratio,
                weight: reading.openInterestUsd,
                timestamp: current.timestamp,
                previous,
            }];
    });
    const currentRatio = weightedRatio(currentSamples);
    const previousSamples = currentSamples.flatMap((sample) => {
        const previous = sample.previous;
        return previous ? [{ ratio: previous.ratio, weight: sample.weight, timestamp: previous.timestamp }] : [];
    });
    const previousRatio = weightedRatio(previousSamples);
    const ratioChangePct = currentRatio !== null && previousRatio !== null && previousRatio !== 0
        ? ((currentRatio - previousRatio) / previousRatio) * 100
        : null;
    const currentLongSharePct = ratioToLongPct(currentRatio);
    const previousLongSharePct = ratioToLongPct(previousRatio);
    const currentTimestamp = currentSamples.length
        ? Math.min(...currentSamples.map((sample) => sample.timestamp))
        : null;
    const previousTimestamp = previousSamples.length
        ? Math.min(...previousSamples.map((sample) => sample.timestamp))
        : null;
    return {
        timeframe,
        ratioChangePct,
        longShareChangePp: currentLongSharePct !== null && previousLongSharePct !== null
            ? currentLongSharePct - previousLongSharePct
            : null,
        currentRatio,
        previousRatio,
        currentLongSharePct,
        previousLongSharePct,
        currentTimestamp: isoDate(currentTimestamp),
        previousTimestamp: isoDate(previousTimestamp),
        sourceCount: previousSamples.length,
        exchanges: [...new Set(currentSamples.map((sample) => sample.exchange).filter(Boolean))],
    };
}
function isUsableReading(reading, now = Date.now()) {
    const latest = reading.points?.at(-1);
    return Number.isFinite(reading.openInterestUsd) && reading.openInterestUsd > 0
        && Number.isFinite(reading.price) && reading.price > 0
        && latest?.timestamp > 0 && Number.isFinite(latest.ratio) && latest.ratio > 0
        && now - latest.timestamp <= 15 * 60_000;
}
export function countFetchedReadings(readings, now = Date.now()) {
    return readings.filter((reading) => isUsableReading(reading, now)).length;
}
function selectDisplayAsset(contracts, fallback) {
    const venueNames = new Map();
    for (const reading of contracts) {
        const name = reading.exchangeAsset || fallback;
        const key = name.toUpperCase();
        const names = venueNames.get(reading.exchange) ?? new Map();
        const existing = names.get(key) ?? { key, name, weight: 0 };
        existing.weight += reading.openInterestUsd;
        names.set(key, existing);
        venueNames.set(reading.exchange, names);
    }
    const votes = new Map();
    for (const names of venueNames.values()) {
        // Multiple contracts from one venue still count as just one exchange.
        const candidate = [...names.values()].sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))[0];
        const vote = votes.get(candidate.key) ?? { name: candidate.name, key: candidate.key, count: 0, weight: 0 };
        vote.count += 1;
        vote.weight += candidate.weight;
        votes.set(candidate.key, vote);
    }
    return [...votes.values()].sort((a, b) => b.count - a.count || b.weight - a.weight || a.key.localeCompare(b.key))[0]?.name ?? fallback;
}
export function createRows(readings) {
    const grouped = new Map();
    for (const reading of readings) {
        if (!isUsableReading(reading))
            continue;
        const group = grouped.get(reading.asset) ?? [];
        group.push(reading);
        grouped.set(reading.asset, group);
    }
    return [...grouped.entries()]
        .map(([asset, contracts]) => {
        const openInterestUsd = contracts.reduce((sum, reading) => sum + reading.openInterestUsd, 0);
        const totalWeight = contracts.reduce((sum, reading) => sum + reading.openInterestUsd, 0);
        const price = totalWeight > 0
            ? contracts.reduce((sum, reading) => sum + reading.price * reading.openInterestUsd, 0) / totalWeight
            : contracts.reduce((sum, reading) => sum + reading.price, 0) / contracts.length;
        const priceChanges = contracts.filter((reading) => reading.priceChange24hPct !== null);
        const priceChangeWeight = priceChanges.reduce((sum, reading) => sum + reading.openInterestUsd, 0);
        const priceChange24hPct = priceChangeWeight > 0
            ? priceChanges.reduce((sum, reading) => sum + (reading.priceChange24hPct ?? 0) * reading.openInterestUsd, 0) / priceChangeWeight
            : null;
        const currentRatio = weightedRatio(contracts.flatMap((reading) => {
            const latest = reading.points[reading.points.length - 1];
            return latest ? [{ ratio: latest.ratio, weight: reading.openInterestUsd }] : [];
        }));
        const exchanges = [...new Set(contracts.map((reading) => reading.exchange))];
        return {
            asset,
            displayAsset: selectDisplayAsset(contracts, asset),
            price,
            priceChange24hPct,
            openInterestUsd,
            exchanges,
            currentRatio,
            longSharePct: ratioToLongPct(currentRatio),
            changes: WINDOWS.map((window) => buildChange(window.timeframe, window.ms, contracts)),
            exchangeReadings: contracts.map((reading) => ({
                exchange: reading.exchange,
                symbol: reading.symbol,
                price: reading.price,
                openInterestUsd: reading.openInterestUsd,
                longShortRatio: reading.points[reading.points.length - 1]?.ratio ?? null,
                longSharePct: ratioToLongPct(reading.points[reading.points.length - 1]?.ratio ?? null),
                updatedAt: isoDate(reading.points[reading.points.length - 1]?.timestamp),
            })),
        };
    })
        .sort((a, b) => a.asset.localeCompare(b.asset));
}
function makeSourceStatus(exchange) {
    const state = exchangeStates[exchange];
    return {
        exchange,
        status: state.status,
        marketCount: countFetchedReadings(sourceReadings[exchange]),
        updatedAt: state.updatedAt,
        error: state.error,
    };
}
function publishSnapshot() {
    const exchanges = Object.keys(exchangeStates);
    const rows = createRows(exchanges.flatMap((exchange) => sourceReadings[exchange]));
    let binance = 0;
    let bybit = 0;
    let both = 0;
    let binanceOnly = 0;
    let bybitOnly = 0;
    for (const row of rows) {
        const hasBinance = row.exchanges.includes("binance");
        const hasBybit = row.exchanges.includes("bybit");
        if (hasBinance)
            binance += 1;
        if (hasBybit)
            bybit += 1;
        if (hasBinance && hasBybit)
            both += 1;
        else if (hasBinance)
            binanceOnly += 1;
        else if (hasBybit)
            bybitOnly += 1;
    }
    cachedSnapshot = {
        generatedAt: new Date(),
        isRefreshing: activeProviderTasks.size > 0,
        totalMarkets: rows.length,
        coverage: { binance, bybit, both, binanceOnly, bybitOnly },
        sources: exchanges.map(makeSourceStatus),
        rows,
    };
}
export function getLsarMarketSnapshot() {
    const fetchers = { binance: fetchBinance, bybit: fetchBybit, okx: fetchOkx, gate: fetchGate, bitget: fetchBitget, toobit: fetchToobit };
    for (const [exchange, fetcher] of Object.entries(fetchers)) {
        if (activeProviderTasks.has(exchange) || Date.now() - (lastProviderAttempts.get(exchange) ?? 0) < REFRESH_INTERVAL_MS) continue;
        lastProviderAttempts.set(exchange, Date.now());
        exchangeStates[exchange] = { ...exchangeStates[exchange], status: "refreshing", error: null };
        const task = fetcher().then((result) => {
            if (result.readings.length) sourceReadings[exchange] = result.readings;
            exchangeStates[exchange] = {
                status: !result.readings.length ? "error" : result.errorCount ? "delayed" : "live",
                marketCount: result.readings.length,
                updatedAt: new Date(),
                error: result.error ?? (result.errorCount ? `${result.errorCount} markets did not return complete account-ratio data.` : null),
            };
            logger.info({ exchange, markets: result.readings.length }, "Exchange account-ratio scan completed");
        }).catch((error) => {
            exchangeStates[exchange] = { ...exchangeStates[exchange], status: sourceReadings[exchange].length ? "delayed" : "error", error: String(error.message ?? error) };
        }).finally(() => {
            activeProviderTasks.delete(exchange);
            publishSnapshot();
        });
        activeProviderTasks.set(exchange, task);
    }
    publishSnapshot();
    return cachedSnapshot;
}
export function getLsarMarketSummary(timeframe) {
    const changes = cachedSnapshot.rows
        .map((row) => ({
        asset: row.asset,
        ratioChangePct: row.changes.find((change) => change.timeframe === timeframe)?.ratioChangePct ?? null,
        exchangeCount: row.exchanges.length,
    }))
        .filter((row) => row.ratioChangePct !== null && Number.isFinite(row.ratioChangePct));
    const strongestIncrease = [...changes].sort((a, b) => b.ratioChangePct - a.ratioChangePct)[0];
    const strongestDecrease = [...changes].sort((a, b) => a.ratioChangePct - b.ratioChangePct)[0];
    return {
        timeframe,
        generatedAt: cachedSnapshot.generatedAt,
        isRefreshing: cachedSnapshot.isRefreshing,
        totalMarkets: cachedSnapshot.totalMarkets,
        dualListed: cachedSnapshot.coverage.both,
        binanceOnly: cachedSnapshot.coverage.binanceOnly,
        bybitOnly: cachedSnapshot.coverage.bybitOnly,
        strongestIncrease: strongestIncrease
            ? { asset: strongestIncrease.asset, ratioChangePct: strongestIncrease.ratioChangePct }
            : null,
        strongestDecrease: strongestDecrease
            ? { asset: strongestDecrease.asset, ratioChangePct: strongestDecrease.ratioChangePct }
            : null,
    };
}
