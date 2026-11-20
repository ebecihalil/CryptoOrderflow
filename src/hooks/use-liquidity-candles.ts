import { useCallback, useEffect, useState } from 'react';
import type { Candle } from '@/lib/liquidity-zones';

export type LiquidityExchange = 'binance' | 'gate' | 'okx' | 'bybit' | 'mexc' | 'bitget' | 'bingx' | 'aster' | 'hyperliquid' | 'kucoin' | 'htx';
export type LiquidityTimeframe = '1s' | '5s' | '15s' | '30s' | '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '24h' | '1w' | '1mo' | '3mo';
export type LiquidityVolumeMode = 'aggregated' | 'single';
export type LiquidityVolumeSource = {
  exchange: 'binance' | 'okx' | 'gate' | 'bybit';
  status: 'ok' | 'unavailable';
  symbol: string | null;
  matchedBars: number;
  fetchedAt?: string;
  error?: string;
};

export type CandleResponse = {
  exchange: LiquidityExchange;
  symbol: string;
  timeframe: LiquidityTimeframe;
  candles: Candle[];
  fetchedAt: string;
  stale: boolean;
  error?: string;
  retryAt?: number;
  volumeMode?: LiquidityVolumeMode;
  volumeAsset?: string;
  volumeSources?: LiquidityVolumeSource[];
  matchedCandleCount?: number;
  partialVolume?: boolean;
};

type LiquidityFeedState = {
  payload: CandleResponse | null;
  error: string | null;
  loading: boolean;
};

export function useLiquidityCandles(
  exchange: LiquidityExchange,
  symbol: string,
  timeframe: LiquidityTimeframe,
  volumeMode: LiquidityVolumeMode = 'aggregated',
  enabled = true,
) {
  const [state, setState] = useState<LiquidityFeedState>({ payload: null, error: null, loading: true });
  const [refreshIndex, setRefreshIndex] = useState(0);
  const refresh = useCallback(() => setRefreshIndex((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let timer: number | undefined;
    if (!enabled) {
      setState({ payload: null, error: null, loading: false });
      return () => {
        active = false;
        controller?.abort();
        window.clearTimeout(timer);
      };
    }
    const load = async (initial: boolean) => {
      controller = new AbortController();
      let failed = false;
      if (initial) setState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const query = new URLSearchParams({ exchange, symbol, timeframe, volumeMode });
        const response = await fetch(`/api/market/candles?${query.toString()}`, { signal: controller.signal });
        // An empty or non-JSON reply (e.g. the proxy's 502 while the server restarts)
        // gets a clear message instead of a JSON parse error.
        const text = await response.text();
        let body: Partial<CandleResponse> & { error?: string };
        try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
        if (!text || (!body.candles && !body.error)) {
          throw new Error(response.ok ? 'Server sent an empty reply. Retrying…' : `Server not responding (${response.status}). Retrying…`);
        }
        if (!response.ok) throw new Error(body.error || `Market data request failed (${response.status})`);
        if (!Array.isArray(body.candles) || typeof body.fetchedAt !== 'string') throw new Error('Market data response was incomplete.');
        if (!active) return;
        setState({ payload: body as CandleResponse, error: body.error ?? null, loading: false });
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
        failed = true;
        setState((previous) => ({
          ...previous,
          payload: previous.payload ? { ...previous.payload, stale: true } : null,
          loading: false,
          error: error instanceof Error ? error.message : 'Unable to load market candles.',
        }));
      } finally {
        // Do not cancel a slow, rate-gated multi-venue load every 30 seconds.
        // Seconds candles come from the server's own trade recorder (no exchange
        // requests), so they refresh every 2 seconds.
        if (active) timer = window.setTimeout(() => void load(false), /s$/.test(timeframe) ? 2_000 : failed ? 5_000 : 30_000);
      }
    };

    void load(true);
    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(timer);
    };
  }, [exchange, symbol, timeframe, volumeMode, refreshIndex, enabled]);

  return { ...state, refresh };
}
