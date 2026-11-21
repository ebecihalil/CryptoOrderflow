import { useQuery } from '@tanstack/react-query';

export type MarketDriverInputBar = {
  time: number; price: { open: number; high: number; low: number; close: number };
  oi: { high: number; low: number; close: number } | null;
  cvd: { open: number; high: number; low: number; close: number; buy: number; sell: number } | null;
  liqLongUsd: number; liqShortUsd: number; lsr: number | null;
};
export type MarketDriverPayload = {
  asset: string; timeframe: string; exchange: string; symbol: string; bars: MarketDriverInputBar[];
  totals: { oiCoin: number | null; oiUsd: number | null; dailyVolumeUsd: number | null; average20dVolumeUsd: number | null };
};

/** OI Market Driver inputs per chart candle (aggregated OI, perp CVD, liquidations, top-trader L/S). */
export function useMarketDriver(asset: string, timeframe: string, exchange: string, symbol: string, enabled: boolean) {
  return useQuery({
    queryKey: ['market-driver', asset, timeframe, exchange, symbol],
    enabled: enabled && !!asset,
    queryFn: async ({ signal }): Promise<MarketDriverPayload> => {
      const response = await fetch(`/api/indicators/market-driver?${new URLSearchParams({ asset, timeframe, exchange, symbol })}`, { signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'OI Market Driver unavailable.');
      return body as MarketDriverPayload;
    },
    refetchInterval: 30_000,
    placeholderData: (previous) => (previous?.asset === asset && previous.timeframe === timeframe && previous.symbol === symbol ? previous : undefined),
    retry: 1,
  });
}
