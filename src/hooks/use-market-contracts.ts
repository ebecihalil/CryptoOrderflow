import { useCallback, useEffect, useState } from 'react';

export type MarketContract = {
  exchange: string;
  tvExchange: string;
  label: string;
  symbol: string;
  ticker: string;
  asset: string;
  exchangeAsset: string;
  priceDivisor: number;
};
export type MarketContractSource = { exchange: string; status: 'ok' | 'loading' | 'unavailable'; coinCount: number };
export type MarketContractsResponse = {
  contracts: MarketContract[];
  sources: MarketContractSource[];
  isRefreshing: boolean;
  generatedAt: string;
};
type State = { data: MarketContractsResponse | null; error: string | null; loading: boolean };

const CACHE_MS = 60 * 60 * 1000;
let cached: MarketContractsResponse | null = null;
let cachedAt = 0;
let inFlight: Promise<MarketContractsResponse> | null = null;

async function fetchCatalogue(force = false): Promise<MarketContractsResponse> {
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  if (!inFlight) {
    inFlight = fetch('/api/market/contracts', { credentials: 'include' })
      .then(async (response) => {
        const body = await response.json() as Partial<MarketContractsResponse> & { error?: string };
        if (!response.ok) throw new Error(body.error || `Contract catalogue request failed (${response.status})`);
        if (!Array.isArray(body.contracts) || !Array.isArray(body.sources)) throw new Error('Contract catalogue response was incomplete.');
        const result = body as MarketContractsResponse;
        cached = result;
        cachedAt = Date.now();
        return result;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function useMarketContracts() {
  const [state, setState] = useState<State>(() => ({
    data: cached && Date.now() - cachedAt < CACHE_MS ? cached : null,
    error: null,
    loading: !(cached && Date.now() - cachedAt < CACHE_MS),
  }));
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => {
    cachedAt = 0;
    setRetry((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async (showLoading: boolean) => {
      let completed = false;
      if (showLoading) setState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const data = await fetchCatalogue(!showLoading);
        completed = true;
        if (active) setState({ data, error: null, loading: false });
      } catch (error) {
        if (active) setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : 'Unable to load contract catalogue.',
        }));
      } finally {
        if (active && completed) {
          const stillLoading = cached?.sources.some((source) => source.status === 'loading') ?? false;
          timer = window.setTimeout(() => void load(false), stillLoading ? 10_000 : CACHE_MS);
        }
      }
    };
    void load(true);
    return () => { active = false; window.clearTimeout(timer); };
  }, [retry]);

  return { ...state, refresh };
}
