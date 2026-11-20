import { useQuery } from '@tanstack/react-query';

export type LeverageTimeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
export type LeverageRow = {
  time: number; price: number | null; oiUsd: number | null; oiSources: string[]; matchedSources: string[];
  oiTurnover: number | null; vsMedian: number | null; pressureIndex: number | null;
  oiChangeUsd: number | null; imbalancePct: number | null;
  buildState: 'long-build' | 'short-build' | 'long-unwind' | 'short-unwind' | 'neutral';
  longBuildUsd: number; shortBuildUsd: number; netLongBuildUsd: number; netShortBuildUsd: number; buildOfOiPct: number | null;
  topAccountLongShare: number | null; topPositionLongShare: number | null; globalAccountLongShare: number | null;
  sizeSkew: number | null; retailDivergencePct: number | null; longLiqUsd: number | null; shortLiqUsd: number | null;
  ranks: { pressure: number | null; build: number | null; crowding: number | null; sizeSkew: number | null };
  leverageScore: number | null; sideBias: number | null; flowSources: string[]; topSources: string[];
};
export type LeverageSource = {
  exchange: string; symbol: string | null; status: string; bars: number; errors: string[];
  fetchedAt: string | null; fields: string[];
};
export type LeveragePayload = {
  asset: string; timeframe: LeverageTimeframe; generatedAt: string; isRefreshing: boolean;
  latest: (LeverageRow & { regime: 'low' | 'normal' | 'elevated' | 'extreme' | 'unavailable'; side: 'long-heavy' | 'short-heavy' | 'balanced' | 'unavailable' }) | null;
  rows: LeverageRow[]; sources: LeverageSource[]; warnings: string[];
  settings: { lookback: number; volLen: number; buildWindow: number; minFlowPct: number };
};

export function useLeverageEstimate(asset: string, timeframe: LeverageTimeframe, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['leverage-estimate', asset, timeframe],
    queryFn: async ({ signal }): Promise<LeveragePayload> => {
      const query = new URLSearchParams({ asset, timeframe });
      const response = await fetch(`/api/indicators/leverage?${query}`, { signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Leverage estimate unavailable.');
      if (body.asset !== asset || body.timeframe !== timeframe || !Array.isArray(body.rows))
        throw new Error('Leverage response did not match the selected market.');
      return body as LeveragePayload;
    },
    // The server answers from its cache and refreshes venues in the background;
    // poll faster only while the first fetches are still filling.
    refetchInterval: (query) => (query.state.data?.isRefreshing || !query.state.data?.rows.length ? 5_000 : 30_000),
    placeholderData: (previous) => (previous?.asset === asset && previous.timeframe === timeframe ? previous : undefined),
    retry: 1,
  });
}
