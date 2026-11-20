import { useQuery } from '@tanstack/react-query';

export type LsarKind = 'global' | 'top';
export type LsarChartPoint = { time: number; ratio: number; longPct: number; sources: number };
export type LsarChartPayload = {
  asset: string; kind: LsarKind; timeframe: string; points: LsarChartPoint[];
  sources: Array<{ exchange: string; symbol: string; oiUsd: number }>;
};
/** Chart timeframes the exchanges' ratio history supports (24h = 1D). */
export const LSAR_CHART_FRAMES = ['5m', '15m', '30m', '1h', '4h', '24h'];

export function useLsarChart(asset: string, timeframe: string, kind: LsarKind, enabled: boolean) {
  return useQuery({
    queryKey: ['lsar-chart', kind, asset, timeframe],
    enabled: enabled && LSAR_CHART_FRAMES.includes(timeframe),
    queryFn: async ({ signal }): Promise<LsarChartPayload> => {
      const query = new URLSearchParams({ asset, timeframe, kind });
      const response = await fetch(`/api/indicators/lsar-chart?${query}`, { signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Long/short ratio unavailable.');
      return body as LsarChartPayload;
    },
    // Exchanges publish a new 5-minute ratio; the server refreshes in the background.
    refetchInterval: (query) => (query.state.data?.points.length ? 60_000 : 10_000),
    placeholderData: (previous) => (previous?.asset === asset && previous.timeframe === timeframe && previous.kind === kind ? previous : undefined),
    retry: 1,
  });
}
