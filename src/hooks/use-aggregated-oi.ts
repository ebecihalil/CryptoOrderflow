import { useQuery } from '@tanstack/react-query';

export type AggregatedOiCandle = { time: number; open: number; high: number; low: number; close: number; filled?: boolean };
export type AggregatedOiPayload = {
  asset: string; timeframe: string; unit: 'coin'; candles: AggregatedOiCandle[];
  current: { oiCoin: number; oiUsd: number }; exchanges: Array<{ exchange: string; oiCoin: number; history: string }>;
  isLoading: boolean; generatedAt: string;
};

/** Total open interest (coins) of every USDT/USDC perpetual of the coin, as chart-timeframe candles. */
export function useAggregatedOi(asset: string, timeframe: string, enabled: boolean) {
  return useQuery({
    queryKey: ['aggregated-oi', asset, timeframe],
    enabled: enabled && !!asset,
    queryFn: async ({ signal }): Promise<AggregatedOiPayload> => {
      const response = await fetch(`/api/indicators/aggregated-oi?${new URLSearchParams({ asset, timeframe })}`, { signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Aggregated open interest unavailable.');
      return body as AggregatedOiPayload;
    },
    refetchInterval: (query) => (query.state.data?.isLoading ? 5_000 : 30_000),
    placeholderData: (previous) => (previous?.asset === asset && previous.timeframe === timeframe ? previous : undefined),
    retry: 1,
  });
}
