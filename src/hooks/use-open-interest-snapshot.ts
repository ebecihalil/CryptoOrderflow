import { useQuery } from '@tanstack/react-query';
import type { OiSnapshot, OiTimeframe } from '@/types/open-interest';

export function useOpenInterestSnapshot(timeframe: OiTimeframe, exchanges: string[] = []) {
  const selection = [...exchanges].sort().join(',');
  return useQuery({
    queryKey: ['open-interest-snapshot', timeframe, selection],
    queryFn: async ({ signal }): Promise<OiSnapshot> => {
      const params = new URLSearchParams({ timeframe });
      if (selection) params.set('exchanges', selection);
      const response = await fetch(`/api/market/open-interest?${params}`, { signal });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error ?? `Open interest request failed (${response.status})`);
      }
      return response.json();
    },
    refetchInterval: (query) => query.state.data?.isRefreshing ? 15_000 : 60_000,
    staleTime: 15_000,
    retry: 1,
  });
}
