import type { FundingSource } from './funding';

export type OiTimeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '24h';
export interface OiVenue {
  oiCoin: number | null;
  oiUsd: number;
  changePct: number | null;
  volume24hUsd: number | null;
  reportedAt: string | null;
  contractCount: number;
}
export interface OiRow {
  asset: string;
  displayAsset: string;
  aggregateOiCoin: number | null;
  aggregateOiUsd: number;
  changePct: number | null;
  oiVolumeRatio: number | null;
  volume24hUsd: number | null;
  volumeSourceCount: number;
  sourceCount: number;
  matchedSourceCount: number;
  venues: Record<string, OiVenue>;
}
export interface OiSnapshot {
  generatedAt: string;
  timeframe: OiTimeframe;
  isRefreshing: boolean;
  universeReady: boolean;
  totalOpenInterestUsd: number;
  historyReadyCount: number;
  sources: FundingSource[];
  rows: OiRow[];
  extremes: { gainers: OiRow[]; losers: OiRow[] };
  cmeReportDates: string[];
  notes: string[];
}
