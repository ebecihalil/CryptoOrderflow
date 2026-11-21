import { useQuery } from '@tanstack/react-query';
import type { VolumeProfilePayload } from '@/lib/volume-profile';

/** Recorded aggressive buy/sell volume per price level, per UTC day (all exchanges). */
export function useVolumeProfile(asset: string, market: string, enabled: boolean) {
  return useQuery({
    queryKey: ['volume-profile', asset, market],
    enabled: enabled && !!asset,
    queryFn: async ({ signal }): Promise<VolumeProfilePayload> => {
      const response = await fetch(`/api/indicators/volume-profile?${new URLSearchParams({ asset, market })}`, { signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Volume profile unavailable.');
      return body as VolumeProfilePayload;
    },
    refetchInterval: 30_000,
    placeholderData: (previous) => (previous?.asset === asset && previous.market === market ? previous : undefined),
    retry: 1,
  });
}
