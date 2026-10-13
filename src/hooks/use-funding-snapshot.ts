import { useQuery } from '@tanstack/react-query';
import type { FundingSnapshot, FundingTimeframe } from '@/types/funding';

async function fetchFundingSnapshot(timeframe: FundingTimeframe, signal?: AbortSignal): Promise<FundingSnapshot> {
  const response = await fetch(`/api/market/funding?timeframe=${encodeURIComponent(timeframe)}`, {
    signal,
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? body.error : `Funding data request failed (${response.status})`);
  }
  return await response.json() as FundingSnapshot;
}

export function useFundingSnapshot(timeframe: FundingTimeframe) {
  return useQuery({
    queryKey: ['funding-snapshot', timeframe],
    queryFn: ({ signal }) => fetchFundingSnapshot(timeframe, signal),
    refetchInterval: (query) => query.state.data?.isRefreshing ? 15_000 : 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
