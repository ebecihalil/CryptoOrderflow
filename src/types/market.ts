export type LsarTimeframe = "5m" | "15m" | "30m" | "1h" | "4h" | "24h";
export type MarketExchange = "binance" | "bybit" | "okx" | "gate" | "bitget";

export interface MarketSourceStatus {
  exchange: MarketExchange;
  status: "connecting" | "refreshing" | "live" | "delayed" | "error";
  marketCount: number;
  updatedAt: string | null;
  error: string | null;
}

export interface LsarChange {
  timeframe: LsarTimeframe;
  ratioChangePct: number | null;
  longShareChangePp: number | null;
  currentRatio: number | null;
  previousRatio: number | null;
  currentLongSharePct: number | null;
  previousLongSharePct: number | null;
  currentTimestamp: string | null;
  previousTimestamp: string | null;
  sourceCount: number;
  exchanges: MarketExchange[];
}

export interface LsarExchangeReading {
  exchange: MarketExchange;
  symbol: string;
  price: number;
  openInterestUsd: number;
  longShortRatio: number | null;
  longSharePct: number | null;
  updatedAt: string | null;
}

export interface LsarInstrument {
  asset: string;
  displayAsset: string;
  price: number;
  priceChange24hPct: number | null;
  openInterestUsd: number;
  exchanges: MarketExchange[];
  currentRatio: number | null;
  longSharePct: number | null;
  changes: LsarChange[];
  exchangeReadings: LsarExchangeReading[];
}

export interface LsarMarketSnapshot {
  generatedAt: string | null;
  isRefreshing: boolean;
  totalMarkets: number;
  coverage: {
    binance: number;
    bybit: number;
    both: number;
    binanceOnly: number;
    bybitOnly: number;
  };
  sources: MarketSourceStatus[];
  rows: LsarInstrument[];
}

export interface LsarMarketSummary {
  timeframe: LsarTimeframe;
  generatedAt: string | null;
  isRefreshing: boolean;
  totalMarkets: number;
  dualListed: number;
  binanceOnly: number;
  bybitOnly: number;
  strongestIncrease: { asset: string; ratioChangePct: number } | null;
  strongestDecrease: { asset: string; ratioChangePct: number } | null;
}

export interface HealthStatus {
  status: string;
}
