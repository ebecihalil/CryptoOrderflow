import { useCallback, useEffect, useState } from 'react';

export type CvdMarket = 'spot' | 'perpetual';
export type CvdAnchor = '1d' | '1w' | '1m' | '3m' | '6m' | '1y';
export type CvdTimeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '24h';
export type CvdCandle = {
  time: number; open: number; high: number; low: number; close: number;
  buyValue: number; sellValue: number; trades: number; sourceCount: number;
  provisional: boolean; partial: boolean; segmentStart: boolean;
};
export type CvdSource = {
  exchange: string; status: 'loading' | 'live' | 'unavailable' | 'reconnecting' | 'not_listed' | 'idle';
  symbol: string | null; tradeCount: number; lastTradeAt: string | null;
};
export type CvdPayload = {
  asset: string; market: CvdMarket; timeframe: CvdTimeframe; anchor: CvdAnchor;
  unit: 'USD-equivalent'; anchorStart: number; completeAnchor: boolean;
  recordingStartedAt: string; historyStart: string | null; historyEnd: string | null;
  candles: CvdCandle[]; sources: CvdSource[]; generatedAt: string;
  warnings: string[]; storage: 'local-recording'; isLoading: boolean;
};
type State = { payload: CvdPayload | null; loading: boolean; error: string | null };

export function useCvdIndicator(
  asset: string, market: CvdMarket, timeframe: CvdTimeframe, anchor: CvdAnchor, enabled = true,
) {
  const [state, setState] = useState<State>({ payload: null, loading: false, error: null });
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry(value => value + 1), []);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    if (!enabled) {
      setState({ payload: null, loading: false, error: null });
      return;
    }
    setState({ payload: null, loading: true, error: null });
    const load = async () => {
      controller = new AbortController();
      try {
        const query = new URLSearchParams({ asset, market, timeframe, anchor });
        const response = await fetch(`/api/indicators/cvd?${query}`, { signal: controller.signal });
        const body = await response.json() as CvdPayload & { error?: string };
        if (!response.ok) throw new Error(body.error || 'CVD feed unavailable.');
        if (body.asset !== asset || body.market !== market || body.timeframe !== timeframe ||
          body.anchor !== anchor || !Array.isArray(body.candles) || !Array.isArray(body.sources)) {
          throw new Error('CVD response does not match the selected market.');
        }
        if (active) setState({ payload: body, loading: false, error: null });
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
          setState(previous => ({ ...previous, loading: false,
            error: error instanceof Error ? error.message : 'CVD feed unavailable.' }));
        }
      } finally {
        if (active) timer = window.setTimeout(load, 5000);
      }
    };
    void load();
    return () => { active = false; controller?.abort(); window.clearTimeout(timer); };
  }, [asset, market, timeframe, anchor, enabled, retry]);
  return { ...state, refresh };
}
