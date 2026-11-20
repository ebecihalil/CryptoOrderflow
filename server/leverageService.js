import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { marketContractService } from "./marketContracts.js";
import { LEVERAGE_EXCHANGES, LEVERAGE_FETCHERS, LEVERAGE_TIMEFRAMES, spotSymbolFor } from "./leverageSources.js";
import { calculateLeverage, leverageRegime, mergeVenueBars, sideLabel, LEVERAGE_DEFAULTS } from "./leverageMath.js";

const MAX_GROUPS = 8, IDLE_MS = 30 * 60_000, STALE_MS = 30 * 60_000, MAX_ROWS = 500;
const refreshMsFor = timeframe => (["5m", "15m"].includes(timeframe) ? 120_000 : 300_000);

const FIELD_LABELS = {
  oiUsd: "OI", spotTurnoverUsd: "Spot turnover", topAccountRatio: "Top-trader accounts",
  topPositionRatio: "Top-trader positions", globalAccountRatio: "All-account ratio",
  takerBuyUsd: "Taker buy/sell (footprint)", longLiqUsd: "Liquidations",
};

function validate(query) {
  const asset = typeof query.asset === "string" ? canonicalAsset(query.asset.trim().toUpperCase()).asset : "";
  const timeframe = query.timeframe ?? "1h";
  if (!/^[A-Z0-9]{1,30}$/.test(asset) || !isCryptoAsset(asset) || !Object.hasOwn(LEVERAGE_TIMEFRAMES, timeframe))
    throw Object.assign(new Error("A verified crypto asset and a timeframe of 5m, 15m, 30m, 1h, 4h or 1d are required."), { status: 400 });
  return { asset, timeframe };
}

/** Prefer the venue's plain-denominated USDT perpetual over 1000x variants. */
export function pickContract(contracts, exchange, asset) {
  const candidates = contracts.filter(item => item.exchange === exchange && item.asset === asset);
  return candidates.find(item => item.exchangeAsset === asset) ?? candidates[0] ?? null;
}

export function createLeverageService({
  fetchers = LEVERAGE_FETCHERS, catalogue = marketContractService, now = Date.now,
} = {}) {
  const groups = new Map();

  function evict() {
    for (const [key, group] of groups) if (now() - group.lastPolled > IDLE_MS && !group.pending) groups.delete(key);
    if (groups.size < MAX_GROUPS) return;
    const oldest = [...groups].filter(([, group]) => !group.pending).sort((a, b) => a[1].lastPolled - b[1].lastPolled)[0];
    if (oldest && now() - oldest[1].lastPolled > 60_000) groups.delete(oldest[0]);
    else throw Object.assign(new Error("Leverage estimate capacity is busy. Please retry shortly."), { status: 503 });
  }

  function refresh(group) {
    const contracts = catalogue.get().contracts;
    group.nextRefresh = now() + refreshMsFor(group.timeframe);
    const tasks = LEVERAGE_EXCHANGES.map(async exchange => {
      const source = group.sources[exchange];
      const contract = pickContract(contracts, exchange, group.asset);
      if (!contract) { source.status = "not listed"; source.symbol = null; return; }
      source.symbol = contract.symbol;
      source.status = source.bars.length ? "refreshing" : "loading";
      try {
        const result = await fetchers[exchange]({
          symbol: contract.symbol, spotSymbol: spotSymbolFor(exchange, group.asset), timeframe: group.timeframe,
        });
        source.bars = result.bars; source.fetchedAt = now();
        source.errors = result.errors;
        source.status = result.errors.length ? "partial" : "live";
      } catch (error) {
        source.errors = [error?.message ?? "Request failed"];
        // Keep recent verified bars visibly cached; never present them as live.
        if (source.fetchedAt && now() - source.fetchedAt <= STALE_MS) source.status = "cached";
        else { source.status = "unavailable"; source.bars = []; }
      }
    });
    group.pending = Promise.allSettled(tasks).finally(() => { group.pending = null; });
    return group.pending;
  }

  function group(asset, timeframe) {
    const key = `${asset}|${timeframe}`;
    let item = groups.get(key);
    if (!item) {
      evict();
      item = { asset, timeframe, lastPolled: now(), nextRefresh: 0, pending: null,
        sources: Object.fromEntries(LEVERAGE_EXCHANGES.map(exchange => [exchange,
          { exchange, symbol: null, status: "loading", bars: [], errors: [], fetchedAt: null }])) };
      groups.set(key, item);
    }
    item.lastPolled = now();
    if (!item.pending && now() >= item.nextRefresh) void refresh(item);
    return item;
  }

  function get(query) {
    const { asset, timeframe } = validate(query);
    const state = group(asset, timeframe);
    const venues = Object.fromEntries(Object.values(state.sources).filter(source => source.bars.length)
      .map(source => [source.exchange, source.bars]));
    const rows = calculateLeverage(mergeVenueBars(venues)).slice(-MAX_ROWS);
    const latest = [...rows].reverse().find(row => row.leverageScore !== null) ?? rows.at(-1) ?? null;
    const sources = Object.values(state.sources).map(source => ({
      exchange: source.exchange, symbol: source.symbol, status: source.status,
      bars: source.bars.length, errors: source.errors,
      fetchedAt: source.fetchedAt ? new Date(source.fetchedAt).toISOString() : null,
      fields: Object.entries(FIELD_LABELS).filter(([field]) => source.bars.some(bar => bar[field] !== undefined)).map(([, label]) => label),
    }));
    const warnings = [];
    if (!sources.some(source => source.fields.includes("Top-trader positions")))
      warnings.push("No top-trader position ratio is currently available; size skew and crowding are excluded from the score.");
    if (!sources.some(source => source.fields.includes("Taker buy/sell (footprint)")))
      warnings.push("No taker buy/sell footprint history is currently available; OI changes cannot be attributed to longs or shorts.");
    const binance = state.sources.binance;
    if (binance.errors.some(error => /HTTP 451|restricted/i.test(error)))
      warnings.push("Binance futures data is geo-blocked for this server's region. See docs/binance-access.md (BINANCE_RELAY_URL or a supported hosting region).");
    return {
      asset, timeframe, generatedAt: new Date(now()).toISOString(),
      isRefreshing: state.pending !== null,
      latest: latest && {
        ...latest, regime: leverageRegime(latest.leverageScore), side: sideLabel(latest.sideBias),
      },
      rows, sources, warnings,
      settings: LEVERAGE_DEFAULTS,
    };
  }

  return { get, refresh: (asset, timeframe) => refresh(group(asset, timeframe)) };
}

export const leverageService = createLeverageService();
