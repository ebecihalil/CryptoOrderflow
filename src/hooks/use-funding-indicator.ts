import { useCallback, useEffect, useRef, useState } from 'react';

export type FundingIndicatorTimeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '24h';
export type FundingIndicatorWindow = '1d' | '7d' | '30d';
export type FundingIndicatorMethod = 'mean' | 'median' | 'weighted';
export type FundingIndicatorSource = {
  exchange: string;
  label: string;
  symbol: string | null;
  status: 'ok' | 'loading' | 'unavailable';
  ratePct: number | null;
  nativeRatePct: number | null;
  intervalHours: number | null;
  oiUsd: number | null;
  fetchedAt: string | null;
  historyStatus: 'ready' | 'partial' | 'loading' | 'unavailable';
  historyNote?: string;
};
export type FundingIndicatorPoint = {
  time: number;
  meanPct: number | null;
  medianPct: number | null;
  weightedPct?: number | null;
  weightedFallback?: boolean;
  sourceCount: number;
};
export type FundingIndicatorResponse = {
  asset: string;
  generatedAt: string;
  isRefreshing: boolean;
  basis: 'normalized8h';
  current: {
    time: number;
    meanPct: number | null;
    medianPct: number | null;
    weightedPct: number | null;
    weightedFallback: boolean;
    sourceCount: number;
    totalOiUsd: number;
  };
  sources: FundingIndicatorSource[];
  history: {
    kind: 'settled';
    points: FundingIndicatorPoint[];
    sourcesReady: number;
    isLoading: boolean;
  };
  observations: {
    kind: 'recordedLive';
    points: FundingIndicatorPoint[];
    startedAt: string | null;
  };
  historyWindow: string;
  timeframe: string;
};
type FeedState = { payload: FundingIndicatorResponse | null; error: string | null; loading: boolean; stale: boolean };

export function normalizeFundingAsset(input: string): string {
  const base = input.trim().toUpperCase().replace(/\s+/g, '').replace(/\.P$/, '').replace(/USDT$/, '');
  const alias = ({ XBT: 'BTC', XDG: 'DOGE' } as Record<string, string>)[base];
  if (alias) return alias;
  const letterMultiplier = base.match(/^1([KM])([A-Z].*)$/);
  if (letterMultiplier) return letterMultiplier[2];
  const numericMultiplier = base.match(/^(10{2,})([A-Z].*)$/);
  if (numericMultiplier && Number.isSafeInteger(Number(numericMultiplier[1]))) return numericMultiplier[2];
  return base;
}

export function useFundingIndicator(asset: string, timeframe: FundingIndicatorTimeframe, historyWindow: FundingIndicatorWindow) {
  const [state, setState] = useState<FeedState>({ payload: null, error: null, loading: true, stale: false });
  const [refreshIndex, setRefreshIndex] = useState(0);
  const refreshingRef = useRef(false);
  refreshingRef.current = !!state.payload?.isRefreshing;
  const refresh = useCallback(() => setRefreshIndex((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    let nextRefreshing = false;
    const load = async (initial: boolean) => {
      controller = new AbortController();
      if (initial) setState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const query = new URLSearchParams({ asset, timeframe, window: historyWindow });
        const response = await fetch(`/api/indicators/funding?${query.toString()}`, { signal: controller.signal });
        const body = await response.json() as Partial<FundingIndicatorResponse> & { error?: string };
        if (!response.ok) throw new Error(body.error || `Funding feed request failed (${response.status})`);
        if (!body.current || !Array.isArray(body.sources) || !body.history || !body.observations) {
          throw new Error('Funding feed response was incomplete.');
        }
        if (!active) return;
        nextRefreshing = body.isRefreshing === true;
        setState({ payload: body as FundingIndicatorResponse, error: null, loading: false, stale: false });
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
        setState((previous) => ({
          ...previous,
          loading: false,
          stale: !!previous.payload,
          error: error instanceof Error ? error.message : 'Unable to load funding data.',
        }));
      } finally {
        // Schedule only after a request settles; slow shared-source refreshes are not aborted by polling.
        if (active) {
          const delay = nextRefreshing || refreshingRef.current ? 10_000 : 30_000;
          timer = globalThis.window.setTimeout(() => void load(false), delay);
        }
      }
    };
    void load(true);
    return () => {
      active = false;
      controller?.abort();
      globalThis.window.clearTimeout(timer);
    };
  }, [asset, timeframe, historyWindow, refreshIndex]);

  return { ...state, refresh };
}
