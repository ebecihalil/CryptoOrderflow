import { useCallback, useEffect, useState } from 'react';
import type { CvdMarket, CvdSource, CvdTimeframe } from './use-cvd-indicator';

export type AggressiveBubblesMarket = 'both' | CvdMarket;
export type AggressiveBubble = {
  id: string; market: CvdMarket; side: 'buy' | 'sell'; time: number;
  price: number; value: number; tradeCount: number; sourceCount: number;
};
export type AggressiveBubblesPayload = {
  asset: string; timeframe: CvdTimeframe; market: AggressiveBubblesMarket; minValue: number;
  unit: 'USD-equivalent'; points: AggressiveBubble[];
  recordingStartedAt: string; historyStart: string | null; historyEnd: string | null;
  sources: Array<CvdSource & { market: CvdMarket }>;
  warnings: string[]; aggregation: { priceBandPercent: number; time: 'chart_candle' }; isLoading: boolean;
};
type State = { payload: AggressiveBubblesPayload | null; loading: boolean; error: string | null };

export function useAggressiveBubbles(
  asset: string, timeframe: CvdTimeframe, market: AggressiveBubblesMarket,
  minValue: number, enabled = true,
) {
  const [state, setState] = useState<State>({ payload: null, loading: false, error: null });
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry(value => value + 1), []);
  useEffect(() => {
    let active = true, timer: number | undefined, controller: AbortController | undefined;
    if (!enabled) { setState({ payload: null, loading: false, error: null }); return; }
    setState({ payload: null, loading: true, error: null });
    async function load() {
      controller = new AbortController();
      try {
        const query = new URLSearchParams({ asset, timeframe, market, minValue: String(minValue) });
        const response = await fetch(`/api/indicators/aggressive-bubbles?${query}`, { signal: controller.signal });
        const body = await response.json() as AggressiveBubblesPayload & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Aggressive Volume Bubbles feed unavailable.');
        if (body.asset !== asset || body.market !== market || body.timeframe !== timeframe ||
          body.minValue !== minValue || !Array.isArray(body.points) || !Array.isArray(body.sources)) {
          throw new Error('Bubble response does not match the selected contract and filters.');
        }
        if (active) setState({ payload: body, loading: false, error: null });
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
          setState(previous => ({ ...previous, loading: false,
            error: error instanceof Error ? error.message : 'Aggressive Volume Bubbles feed unavailable.' }));
        }
      } finally { if (active) timer = window.setTimeout(load, 5000); }
    }
    void load();
    return () => { active = false; controller?.abort(); window.clearTimeout(timer); };
  }, [asset, timeframe, market, minValue, enabled, retry]);
  return { ...state, refresh };
}
