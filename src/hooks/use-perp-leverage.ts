import { useQuery } from '@tanstack/react-query';

export type PerpLeverageRow = { time: number; avg: number | null; long: number | null; short: number | null; exchanges?: string[]; longShare?: number };
export type PerpLeveragePayload = { asset: string; timeframe: string; rows: PerpLeverageRow[]; exchangesUsed: string[] };
/** Chart timeframes the open-interest history supports (24h = 1D). */
export const PERP_LEVERAGE_FRAMES = ['5m', '15m', '30m', '1h', '4h', '24h'];

export function usePerpLeverage(asset: string, timeframe: string, exchange: string, symbol: string, enabled: boolean) {
  return useQuery({
    queryKey: ['perp-leverage', asset, timeframe, exchange, symbol],
    enabled: enabled && PERP_LEVERAGE_FRAMES.includes(timeframe),
    queryFn: async ({ signal }): Promise<PerpLeveragePayload> => {
      const query = new URLSearchParams({ asset, timeframe, exchange, symbol });
      const response = await fetch(`/api/indicators/perp-leverage?${query}`, { signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Perp leverage estimation unavailable.');
      return body as PerpLeveragePayload;
    },
    refetchInterval: 60_000,
    placeholderData: (previous) => (previous?.asset === asset && previous.timeframe === timeframe ? previous : undefined),
    retry: 1,
  });
}
