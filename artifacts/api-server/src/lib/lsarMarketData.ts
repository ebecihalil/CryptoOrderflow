import type {
  LsarMarketSnapshot,
  LsarInstrument,
  LsarTimeframe,
  MarketExchange,
  MarketSourceStatus,
} from "@workspace/api-zod";
import { logger } from "./logger";

const BINANCE_BASE = "https://fapi.binance.com";
const BINANCE_COINM_BASE = "https://dapi.binance.com";
const BYBIT_BASE = "https://api.bybit.com";
const REFRESH_INTERVAL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const HISTORY_LIMIT = 300;
const WINDOWS: { timeframe: LsarTimeframe; ms: number }[] = [
  { timeframe: "5m", ms: 5 * 60_000 },
  { timeframe: "15m", ms: 15 * 60_000 },
  { timeframe: "30m", ms: 30 * 60_000 },
  { timeframe: "1h", ms: 60 * 60_000 },
  { timeframe: "4h", ms: 4 * 60 * 60_000 },
  { timeframe: "24h", ms: 24 * 60 * 60_000 },
];

interface RatioPoint {
  timestamp: number;
  ratio: number;
}

interface ContractReading {
  exchange: MarketExchange;
  symbol: string;
  asset: string;
  price: number;
  priceChange24hPct: number | null;
  openInterestUsd: number;
  points: RatioPoint[];
}

interface ExchangeFetchResult {
  readings: ContractReading[];
  marketCount: number;
  errorCount: number;
  error: string | null;
}

interface ExchangeState {
  status: MarketSourceStatus["status"];
  marketCount: number;
  updatedAt: Date | null;
  error: string | null;
}

const exchangeStates: Record<MarketExchange, ExchangeState> = {
  binance: { status: "connecting", marketCount: 0, updatedAt: null, error: null },
  bybit: { status: "connecting", marketCount: 0, updatedAt: null, error: null },
};

const sourceReadings: Record<MarketExchange, ContractReading[]> = {
  binance: [],
  bybit: [],
};

let lastAttemptAt = 0;
let refreshTask: Promise<void> | null = null;
let nextBybitRequestAt = 0;

let cachedSnapshot: LsarMarketSnapshot = {
  generatedAt: null,
  isRefreshing: false,
  totalMarkets: 0,
  coverage: { binance: 0, bybit: 0, both: 0, binanceOnly: 0, bybitOnly: 0 },
  sources: [
    { exchange: "binance", status: "connecting", marketCount: 0, updatedAt: null, error: null },
    { exchange: "bybit", status: "connecting", marketCount: 0, updatedAt: null, error: null },
  ],
  rows: [],
};

interface BinanceContract {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  contractType: string;
  status: string;
}

interface BinanceExchangeInfo {
  symbols: BinanceContract[];
}

interface BinancePriceTicker {
  symbol: string;
  price: string;
}

interface Binance24hTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

interface BinanceOpenInterest {
  openInterest: string;
  time: number;
}

interface BinanceRatioItem {
  longShortRatio: string;
  timestamp: number;
}

interface BinanceCoinMContract {
  symbol: string;
  pair: string;
  baseAsset: string;
  contractSize: string | number;
  contractType: string;
  contractStatus: string;
}

interface BinanceCoinMExchangeInfo {
  symbols: BinanceCoinMContract[];
}

interface BybitInstrument {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  contractType: string;
  status: string;
}

interface BybitInstrumentsResponse {
  retCode: number;
  retMsg: string;
  result: {
    list: BybitInstrument[];
    nextPageCursor?: string;
  };
}

interface BybitTicker {
  symbol: string;
  lastPrice: string;
  price24hPcnt: string;
  openInterestValue: string;
}

interface BybitTickersResponse {
  retCode: number;
  retMsg: string;
  result: { list: BybitTicker[] };
}

interface BybitRatioItem {
  buyRatio: string;
  sellRatio: string;
  timestamp: string;
}

interface BybitRatioResponse {
  retCode: number;
  retMsg: string;
  result: { list: BybitRatioItem[] };
}

type BybitCategory = "linear" | "inverse";

function finiteNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(timestamp: number | null | undefined): Date | null {
  return timestamp && Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function canonicalAsset(base: string): { asset: string; priceDivisor: number } {
  const letterMultiplier = base.match(/^1([KM])([A-Z].*)$/i);
  if (letterMultiplier) {
    const multiplier = letterMultiplier[1].toUpperCase() === "M" ? 1_000_000 : 1_000;
    return { asset: letterMultiplier[2], priceDivisor: multiplier };
  }
  const match = base.match(/^(10{3,})([A-Z].*)$/i);
  if (!match) return { asset: base, priceDivisor: 1 };
  const multiplier = Number(match[1]);
  return Number.isFinite(multiplier) ? { asset: match[2], priceDivisor: multiplier } : { asset: base, priceDivisor: 1 };
}

async function fetchJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
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
      const body = (await response.json()) as T & { retCode?: number; retMsg?: string };
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
    } catch (error) {
      lastError = error;
      if (attempt < 2 && error instanceof Error && error.name === "TimeoutError") {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      if (attempt < 2 && error instanceof TypeError) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      if (attempt === 2) break;
      if (!(error instanceof Error) || !error.message.startsWith("Exchange returned HTTP")) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Exchange request failed");
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  work: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
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

function parseBinanceHistory(items: BinanceRatioItem[]): RatioPoint[] {
  return items
    .map((item) => ({
      timestamp: item.timestamp,
      ratio: finiteNumber(item.longShortRatio) ?? 0,
    }))
    .filter((item) => item.timestamp > 0 && item.ratio > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function parseBybitHistory(items: BybitRatioItem[]): RatioPoint[] {
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

async function fetchBinanceLinear(): Promise<ExchangeFetchResult> {
  const [info, priceTickers, dayTickers] = await Promise.all([
    fetchJson<BinanceExchangeInfo>(`${BINANCE_BASE}/fapi/v1/exchangeInfo`),
    fetchJson<BinancePriceTicker[]>(`${BINANCE_BASE}/fapi/v1/ticker/price`),
    fetchJson<Binance24hTicker[]>(`${BINANCE_BASE}/fapi/v1/ticker/24hr`),
  ]);
  const prices = new Map(priceTickers.map((ticker) => [ticker.symbol, finiteNumber(ticker.price)]));
  const changes = new Map(
    dayTickers.map((ticker) => [ticker.symbol, finiteNumber(ticker.priceChangePercent)]),
  );
  const contracts = info.symbols.filter(
    (contract) =>
      contract.contractType === "PERPETUAL" &&
      contract.status === "TRADING" &&
      (contract.quoteAsset === "USDT" || contract.quoteAsset === "USDC"),
  );

  let errorCount = 0;
  const readings = await mapLimit(contracts, 8, async (contract): Promise<ContractReading | null> => {
    const price = prices.get(contract.symbol);
    if (price == null || price <= 0) {
      errorCount += 1;
      return null;
    }
    try {
      const [history, oi] = await Promise.all([
        fetchJson<BinanceRatioItem[]>(
          `${BINANCE_BASE}/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(contract.symbol)}&period=5m&limit=${HISTORY_LIMIT}`,
        ),
        fetchJson<BinanceOpenInterest>(
          `${BINANCE_BASE}/fapi/v1/openInterest?symbol=${encodeURIComponent(contract.symbol)}`,
        ),
      ]);
      const openInterest = finiteNumber(oi.openInterest);
      if (openInterest == null || openInterest <= 0) return null;
      const normalized = canonicalAsset(contract.baseAsset);
      return {
        exchange: "binance",
        symbol: contract.symbol,
        asset: normalized.asset,
        price: price / normalized.priceDivisor,
        priceChange24hPct: changes.get(contract.symbol) ?? null,
        openInterestUsd: openInterest * price,
        points: parseBinanceHistory(history),
      };
    } catch {
      errorCount += 1;
      return null;
    }
  });

  return {
    readings: readings.filter((reading): reading is ContractReading => reading !== null),
    marketCount: contracts.length,
    errorCount,
    error: null,
  };
}

async function fetchBinanceCoinM(): Promise<ExchangeFetchResult> {
  const [info, priceTickers, dayTickers] = await Promise.all([
    fetchJson<BinanceCoinMExchangeInfo>(`${BINANCE_COINM_BASE}/dapi/v1/exchangeInfo`),
    fetchJson<BinancePriceTicker[]>(`${BINANCE_COINM_BASE}/dapi/v1/ticker/price`),
    fetchJson<Binance24hTicker[]>(`${BINANCE_COINM_BASE}/dapi/v1/ticker/24hr`),
  ]);
  const prices = new Map(priceTickers.map((ticker) => [ticker.symbol, finiteNumber(ticker.price)]));
  const changes = new Map(
    dayTickers.map((ticker) => [ticker.symbol, finiteNumber(ticker.priceChangePercent)]),
  );
  const contracts = info.symbols.filter(
    (contract) =>
      contract.contractType === "PERPETUAL" &&
      contract.contractStatus === "TRADING" &&
      Number.isFinite(finiteNumber(contract.contractSize)) &&
      (finiteNumber(contract.contractSize) ?? 0) > 0,
  );

  let errorCount = 0;
  const readings = await mapLimit(contracts, 8, async (contract): Promise<ContractReading | null> => {
    const price = prices.get(contract.symbol);
    if (price == null || price <= 0) {
      errorCount += 1;
      return null;
    }
    try {
      const [history, oi] = await Promise.all([
        fetchJson<BinanceRatioItem[]>(
          `${BINANCE_COINM_BASE}/futures/data/globalLongShortAccountRatio?pair=${encodeURIComponent(contract.pair)}&contractType=PERPETUAL&period=5m&limit=${HISTORY_LIMIT}`,
        ),
        fetchJson<BinanceOpenInterest>(
          `${BINANCE_COINM_BASE}/dapi/v1/openInterest?symbol=${encodeURIComponent(contract.symbol)}`,
        ),
      ]);
      const openInterest = finiteNumber(oi.openInterest);
      const contractSize = finiteNumber(contract.contractSize);
      if (openInterest == null || openInterest <= 0 || contractSize == null) return null;
      const normalized = canonicalAsset(contract.baseAsset);
      return {
        exchange: "binance",
        symbol: contract.symbol,
        asset: normalized.asset,
        price: price / normalized.priceDivisor,
        priceChange24hPct: changes.get(contract.symbol) ?? null,
        openInterestUsd: openInterest * contractSize,
        points: parseBinanceHistory(history),
      };
    } catch {
      errorCount += 1;
      return null;
    }
  });

  return {
    readings: readings.filter((reading): reading is ContractReading => reading !== null),
    marketCount: contracts.length,
    errorCount,
    error: null,
  };
}

async function combineExchangeFetches(
  promises: Promise<ExchangeFetchResult>[],
  exchange: MarketExchange,
): Promise<ExchangeFetchResult> {
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

async function fetchBinance(): Promise<ExchangeFetchResult> {
  return combineExchangeFetches([fetchBinanceLinear(), fetchBinanceCoinM()], "binance");
}

async function getBybitContracts(category: BybitCategory): Promise<BybitInstrument[]> {
  const contracts: BybitInstrument[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ category, limit: "1000" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetchJson<BybitInstrumentsResponse>(
      `${BYBIT_BASE}/v5/market/instruments-info?${query}`,
    );
    contracts.push(...response.result.list);
    const next = response.result.nextPageCursor;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return contracts.filter(
    (contract) =>
      contract.status === "Trading" &&
      contract.contractType === (category === "linear" ? "LinearPerpetual" : "InversePerpetual") &&
      (category === "inverse" ||
        contract.quoteCoin === "USDT" ||
        contract.quoteCoin === "USDC"),
  );
}

async function fetchBybitCategory(category: BybitCategory): Promise<ExchangeFetchResult> {
  const [allContracts, allTickers] = await Promise.all([
    getBybitContracts(category),
    fetchJson<BybitTickersResponse>(`${BYBIT_BASE}/v5/market/tickers?category=${category}`),
  ]);
  const tickers = new Map(allTickers.result.list.map((ticker) => [ticker.symbol, ticker]));
  let errorCount = 0;
  const readings = await mapLimit(allContracts, 6, async (contract): Promise<ContractReading | null> => {
    const ticker = tickers.get(contract.symbol);
    const priceValue = finiteNumber(ticker?.lastPrice);
    const oiUsd = finiteNumber(ticker?.openInterestValue);
    if (ticker == null || priceValue == null || priceValue <= 0 || oiUsd == null || oiUsd <= 0) {
      errorCount += 1;
      return null;
    }
    try {
      const history = await fetchJson<BybitRatioResponse>(
        `${BYBIT_BASE}/v5/market/account-ratio?category=${category}&symbol=${encodeURIComponent(contract.symbol)}&period=5min&limit=${HISTORY_LIMIT}`,
      );
      const normalized = canonicalAsset(contract.baseCoin);
      const change = finiteNumber(ticker.price24hPcnt);
      return {
        exchange: "bybit",
        symbol: contract.symbol,
        asset: normalized.asset,
        price: priceValue / normalized.priceDivisor,
        priceChange24hPct: change === null ? null : change * 100,
        openInterestUsd: category === "inverse" ? oiUsd * priceValue : oiUsd,
        points: parseBybitHistory(history.result.list),
      };
    } catch {
      errorCount += 1;
      return null;
    }
  });

  return {
    readings: readings.filter((reading): reading is ContractReading => reading !== null),
    marketCount: allContracts.length,
    errorCount,
    error: null,
  };
}

async function fetchBybit(): Promise<ExchangeFetchResult> {
  return combineExchangeFetches(
    [fetchBybitCategory("linear"), fetchBybitCategory("inverse")],
    "bybit",
  );
}

function weightedRatio(items: { ratio: number; weight: number }[]): number | null {
  const usable = items.filter(
    (item) => Number.isFinite(item.ratio) && item.ratio > 0 && Number.isFinite(item.weight) && item.weight > 0,
  );
  const totalWeight = usable.reduce((total, item) => total + item.weight, 0);
  return totalWeight > 0
    ? usable.reduce((total, item) => total + item.ratio * item.weight, 0) / totalWeight
    : null;
}

function ratioToLongPct(ratio: number | null): number | null {
  return ratio === null ? null : (ratio / (1 + ratio)) * 100;
}

function buildChange(
  timeframe: LsarTimeframe,
  duration: number,
  readings: ContractReading[],
): LsarInstrument["changes"][number] {
  const currentSamples = readings.flatMap((reading) => {
    const latest = reading.points[reading.points.length - 1];
    return latest ? [{ ratio: latest.ratio, weight: reading.openInterestUsd, timestamp: latest.timestamp, reading }] : [];
  });
  const currentRatio = weightedRatio(currentSamples);
  const previousSamples = currentSamples.flatMap((sample) => {
    const target = sample.timestamp - duration;
    let previous: RatioPoint | undefined;
    for (const point of sample.reading.points) {
      if (point.timestamp <= target) previous = point;
      else break;
    }
    return previous ? [{ ratio: previous.ratio, weight: sample.weight, timestamp: previous.timestamp }] : [];
  });
  const previousRatio = weightedRatio(previousSamples);
  const ratioChangePct =
    currentRatio !== null && previousRatio !== null && previousRatio !== 0
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
    longShareChangePp:
      currentLongSharePct !== null && previousLongSharePct !== null
        ? currentLongSharePct - previousLongSharePct
        : null,
    currentRatio,
    previousRatio,
    currentLongSharePct,
    previousLongSharePct,
    currentTimestamp: isoDate(currentTimestamp),
    previousTimestamp: isoDate(previousTimestamp),
    sourceCount: previousSamples.length,
  };
}

function createRows(readings: ContractReading[]): LsarInstrument[] {
  const grouped = new Map<string, ContractReading[]>();
  for (const reading of readings) {
    if (!reading.points.length || reading.openInterestUsd <= 0) continue;
    const group = grouped.get(reading.asset) ?? [];
    group.push(reading);
    grouped.set(reading.asset, group);
  }

  return [...grouped.entries()]
    .map(([asset, contracts]) => {
      const openInterestUsd = contracts.reduce((sum, reading) => sum + reading.openInterestUsd, 0);
      const totalWeight = contracts.reduce((sum, reading) => sum + reading.openInterestUsd, 0);
      const price =
        totalWeight > 0
          ? contracts.reduce((sum, reading) => sum + reading.price * reading.openInterestUsd, 0) / totalWeight
          : contracts.reduce((sum, reading) => sum + reading.price, 0) / contracts.length;
      const priceChanges = contracts.filter((reading) => reading.priceChange24hPct !== null);
      const priceChangeWeight = priceChanges.reduce((sum, reading) => sum + reading.openInterestUsd, 0);
      const priceChange24hPct =
        priceChangeWeight > 0
          ? priceChanges.reduce(
              (sum, reading) => sum + (reading.priceChange24hPct ?? 0) * reading.openInterestUsd,
              0,
            ) / priceChangeWeight
          : null;
      const currentRatio = weightedRatio(
        contracts.flatMap((reading) => {
          const latest = reading.points[reading.points.length - 1];
          return latest ? [{ ratio: latest.ratio, weight: reading.openInterestUsd }] : [];
        }),
      );
      const exchanges = [...new Set(contracts.map((reading) => reading.exchange))];
      return {
        asset,
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

function makeSourceStatus(exchange: MarketExchange): MarketSourceStatus {
  const state = exchangeStates[exchange];
  return {
    exchange,
    status: state.status,
    marketCount: state.marketCount,
    updatedAt: state.updatedAt,
    error: state.error,
  };
}

function publishSnapshot(): void {
  const rows = createRows([...sourceReadings.binance, ...sourceReadings.bybit]);
  let binance = 0;
  let bybit = 0;
  let both = 0;
  let binanceOnly = 0;
  let bybitOnly = 0;
  for (const row of rows) {
    const hasBinance = row.exchanges.includes("binance");
    const hasBybit = row.exchanges.includes("bybit");
    if (hasBinance) binance += 1;
    if (hasBybit) bybit += 1;
    if (hasBinance && hasBybit) both += 1;
    else if (hasBinance) binanceOnly += 1;
    else if (hasBybit) bybitOnly += 1;
  }
  cachedSnapshot = {
    generatedAt: new Date(),
    isRefreshing: Boolean(refreshTask),
    totalMarkets: rows.length,
    coverage: { binance, bybit, both, binanceOnly, bybitOnly },
    sources: [makeSourceStatus("binance"), makeSourceStatus("bybit")],
    rows,
  };
}

async function runRefresh(): Promise<void> {
  lastAttemptAt = Date.now();
  cachedSnapshot = { ...cachedSnapshot, isRefreshing: true };
  for (const exchange of ["binance", "bybit"] as const) {
    exchangeStates[exchange] = { ...exchangeStates[exchange], status: "refreshing", error: null };
  }
  cachedSnapshot = {
    ...cachedSnapshot,
    isRefreshing: true,
    sources: [makeSourceStatus("binance"), makeSourceStatus("bybit")],
  };

  const [binanceResult, bybitResult] = await Promise.allSettled([fetchBinance(), fetchBybit()]);
  const now = new Date();
  if (binanceResult.status === "fulfilled") {
    const result = binanceResult.value;
    if (result.readings.length > 0) sourceReadings.binance = result.readings;
    exchangeStates.binance = {
      status: result.errorCount > 0 ? "delayed" : "live",
      marketCount: result.readings.length,
      updatedAt: now,
      error:
        result.error ??
        (result.errorCount > 0 ? `${result.errorCount} market requests did not return complete data.` : null),
    };
  } else {
    exchangeStates.binance = {
      ...exchangeStates.binance,
      status: sourceReadings.binance.length ? "delayed" : "error",
      error: binanceResult.reason instanceof Error ? binanceResult.reason.message : "Binance request failed.",
    };
  }

  if (bybitResult.status === "fulfilled") {
    const result = bybitResult.value;
    if (result.readings.length > 0) sourceReadings.bybit = result.readings;
    exchangeStates.bybit = {
      status: result.errorCount > 0 ? "delayed" : "live",
      marketCount: result.readings.length,
      updatedAt: now,
      error:
        result.error ??
        (result.errorCount > 0 ? `${result.errorCount} market requests did not return complete data.` : null),
    };
  } else {
    exchangeStates.bybit = {
      ...exchangeStates.bybit,
      status: sourceReadings.bybit.length ? "delayed" : "error",
      error: bybitResult.reason instanceof Error ? bybitResult.reason.message : "Bybit request failed.",
    };
  }

  cachedSnapshot = { ...cachedSnapshot, isRefreshing: false };
  publishSnapshot();
  logger.info(
    {
      binanceMarkets: exchangeStates.binance.marketCount,
      bybitMarkets: exchangeStates.bybit.marketCount,
      aggregateAssets: cachedSnapshot.totalMarkets,
    },
    "Perpetual LSAR market snapshot refreshed",
  );
}

export function getLsarMarketSnapshot(): LsarMarketSnapshot {
  if (!refreshTask && Date.now() - lastAttemptAt >= REFRESH_INTERVAL_MS) {
    refreshTask = runRefresh()
      .catch((error: unknown) => {
        logger.error({ err: error }, "Perpetual LSAR refresh failed");
        cachedSnapshot = { ...cachedSnapshot, isRefreshing: false };
      })
      .finally(() => {
        refreshTask = null;
        cachedSnapshot = { ...cachedSnapshot, isRefreshing: false };
      });
  }
  return cachedSnapshot;
}

export function getLsarMarketSummary(timeframe: LsarTimeframe) {
  const changes = cachedSnapshot.rows
    .map((row) => ({
      asset: row.asset,
      ratioChangePct: row.changes.find((change) => change.timeframe === timeframe)?.ratioChangePct ?? null,
      exchangeCount: row.exchanges.length,
    }))
    .filter(
      (row): row is { asset: string; ratioChangePct: number; exchangeCount: number } =>
        row.ratioChangePct !== null && Number.isFinite(row.ratioChangePct),
    );
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
