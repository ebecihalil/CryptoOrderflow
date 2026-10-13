export type FundingTimeframe = 'current' | '1d' | '7d' | '30d' | '1y';
export interface FundingVenue {
  valuePct: number | null;
  nativeRatePct: number | null;
  normalized8hPct: number | null;
  intervalHours: number | null;
  openInterestUsd: number;
  historyComplete: boolean;
  historyNote: string | null;
  contracts: Array<{ symbol: string; nativeRatePct: number | null; intervalHours: number | null; openInterestUsd: number }>;
}
export interface FundingRow {
  asset: string;
  displayAsset: string;
  aggregatePct: number | null;
  aggregateOpenInterestUsd: number;
  sourceCount: number;
  venues: Record<string, FundingVenue>;
}
export interface FundingSource {
  exchange: string;
  label: string;
  status: 'connecting' | 'refreshing' | 'live' | 'delayed' | 'error' | 'excluded';
  marketCount: number;
  openInterestUsd: number;
  oiSharePct: number | null;
  eligible: boolean;
  updatedAt: string | null;
  error: string | null;
}
export interface FundingSnapshot {
  generatedAt: string;
  timeframe: FundingTimeframe;
  isRefreshing: boolean;
  universeReady: boolean;
  totalOpenInterestUsd: number;
  oiThresholdPct: number;
  sources: FundingSource[];
  rows: FundingRow[];
  highlights: Array<{ asset: string; valuePct: number | null; sourceCount: number }>;
  extremes: {
    highest: Array<{ asset: string; exchange: string; valuePct: number; nativeRatePct: number | null; intervalHours: number | null }>;
    lowest: Array<{ asset: string; exchange: string; valuePct: number; nativeRatePct: number | null; intervalHours: number | null }>;
  };
}
