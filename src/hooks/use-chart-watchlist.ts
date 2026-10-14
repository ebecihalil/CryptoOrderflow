import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketContract } from './use-market-contracts';

export type ChartWatchlistItem = {
  asset: string; contract: MarketContract; addedAt: string;
  status: 'recording' | 'starting' | 'partial' | 'unavailable';
  liveSources: number; totalSources: number;
  historyStart: string | null; historyEnd: string | null; storageFailed: boolean;
};
export type ChartWatchlistPayload = {
  items: ChartWatchlistItem[]; limit: number; retentionDays: number; shared: boolean;
  storageWarning: string; storageFailed: boolean;
};

export function useChartWatchlist() {
  const [data, setData] = useState<ChartWatchlistPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const version = revision.current;
      try {
        const response = await fetch('/api/chart/watchlist', { signal: abort.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Watchlist unavailable.');
        if (mounted.current && version === revision.current) { setData(body); setError(null); }
      } catch (e) {
        if (!abort.signal.aborted && mounted.current && version === revision.current) setError(e instanceof Error ? e.message : 'Watchlist unavailable.');
      } finally { if (!abort.signal.aborted) timer = setTimeout(load, 5000); }
    };
    void load();
    return () => { mounted.current = false; abort.abort(); clearTimeout(timer); };
  }, []);
  const mutate = useCallback(async (method: string, asset?: string, contract?: MarketContract) => {
    revision.current++;
    setPending(true); setError(null);
    try {
      const response = await fetch(`/api/chart/watchlist${asset ? `/${encodeURIComponent(asset)}` : ''}`, {
        method, headers: { 'Content-Type': 'application/json' },
        ...(contract ? { body: JSON.stringify({ exchange: contract.exchange, symbol: contract.symbol }) } : {}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not save watchlist.');
      if (mounted.current) setData(body);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Could not save watchlist.'); }
    finally { revision.current++; if (mounted.current) setPending(false); }
  }, []);
  return { data, error, pending, add: (contract: MarketContract) => mutate('POST', undefined, contract),
    remove: (asset: string) => mutate('DELETE', asset) };
}
