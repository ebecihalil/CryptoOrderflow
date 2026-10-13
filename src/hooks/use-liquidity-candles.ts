import { useCallback, useEffect, useState } from 'react';
import type { Candle } from '@/lib/liquidity-zones';

export type LiquidityExchange = 'binance' | 'bybit';
export type LiquidityTimeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '24h';

export type CandleResponse = {
  exchange: LiquidityExchange;
  symbol: string;
  timeframe: LiquidityTimeframe;
  candles: Candle[];
  fetchedAt: string;
  stale: boolean;
  error?: string;
  retryAt?: number;
};

type LiquidityFeedState = {
  payload: CandleResponse | null;
  error: string | null;
  loading: boolean;
};

export function useLiquidityCandles(exchange: LiquidityExchange, symbol: string, timeframe: LiquidityTimeframe) {
  const [state, setState] = useState<LiquidityFeedState>({ payload: null, error: null, loading: true });
  const [refreshIndex, setRefreshIndex] = useState(0);
  const refresh = useCallback(() => setRefreshIndex((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const load = async (initial: boolean) => {
      controller?.abort();
      controller = new AbortController();
      if (initial) setState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const query = new URLSearchParams({ exchange, symbol, timeframe });
        const response = await fetch(`/api/market/candles?${query.toString()}`, { signal: controller.signal });
        const body = await response.json() as Partial<CandleResponse> & { error?: string };
        if (!response.ok) throw new Error(body.error || `Market data request failed (${response.status})`);
        if (!Array.isArray(body.candles) || typeof body.fetchedAt !== 'string') throw new Error('Market data response was incomplete.');
        if (!active) return;
        setState({ payload: body as CandleResponse, error: body.error ?? null, loading: false });
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
        setState((previous) => ({
          ...previous,
          payload: previous.payload ? { ...previous.payload, stale: true } : null,
          loading: false,
          error: error instanceof Error ? error.message : 'Unable to load market candles.',
        }));
      }
    };

    void load(true);
    const timer = window.setInterval(() => void load(false), 30_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [exchange, symbol, timeframe, refreshIndex]);

  return { ...state, refresh };
}
