import { useQuery } from '@tanstack/react-query';

export type LiquidationBar = { time: number; longUsd: number | null; shortUsd: number | null; oiUsd: number | null };
export type LiquidationPayload = { asset: string; timeframe: string; exchanges: string[]; bars: LiquidationBar[] };

/** Aggregated long/short liquidations per chart candle and the feed exchanges' open interest. */
export function useLiquidations(asset: string, timeframe: string, exchange: string, symbol: string, enabled: boolean) {
  return useQuery({
    queryKey: ['liquidations', asset, timeframe, exchange, symbol],
    enabled: enabled && !!asset,
    queryFn: async ({ signal }): Promise<LiquidationPayload> => {
      const response = await fetch(`/api/indicators/liquidations?${new URLSearchParams({ asset, timeframe, exchange, symbol })}`, { signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Liquidations unavailable.');
      return body as LiquidationPayload;
    },
    refetchInterval: 15_000,
    placeholderData: (previous) => (previous?.asset === asset && previous.timeframe === timeframe ? previous : undefined),
    retry: 1,
  });
}
