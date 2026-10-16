import { useCallback, useEffect, useMemo, useState } from "react";
import type { Candle } from "@/lib/supercharts";
import { calculateOiDriver, OI_DRIVER_DEFAULTS } from "../../server/oiDriverMath.js";

export type OiDriverSettings = {
  showTotals: boolean; stateColors: boolean; showLsar: boolean;
  flatBodyPct: number; activityLength: number; activityFactor: number;
  pinbarBodyPct: number; pinbarWickPct: number; pinbarWickRatio: number;
  spikeMult: number; avgLength: number; maxSidewaysBars: number; pullback1: number; pullback2: number;
  colors: { up: string; down: string; longBuild: string; shortBuild: string; limitBuy: string;
    limitSell: string; shortExit: string; longExit: string; neutral: string };
};
export const DEFAULT_OI_DRIVER_SETTINGS = OI_DRIVER_DEFAULTS as OiDriverSettings;

export type OiDriverCandle = {
  time: number; open: number; high: number; low: number; close: number; color: string;
  state: string; note: string; buyPct: number | null; sellPct: number | null;
  spikePct: number | null; spikeTime: number | null; spikeHigh: number | null;
  pullbackPct: number | null; alerts: string[]; liquidationOiPct: number | null;
  provisional: boolean; sourceCount: number;
};
export type OiDriverSource = { exchange: string; oi: string; cvd: string; liquidations: string; lsar: string };
export type OiDriverPayload = {
  asset: string; exchange: string; symbol: string; timeframe: string; candles: OiDriverCandle[];
  totals: { oiCoin: number | null; oiUsd: number | null; dailyVolumeCoin: number | null; average20dVolumeCoin: number | null };
  sources: OiDriverSource[]; warnings: string[]; generatedAt: string;
};
type Raw = {
  asset: string; exchange: string; symbol: string; timeframe: string;
  candles: Array<{ time: number; open: number; high: number; low: number; close: number; cohort: string;
    segmentStart: boolean; sourceCount: number; provisional: boolean; cvd: { open: number; high: number; low: number;
      close: number; buyValue: number; sellValue: number } | null; longLiqUsd: number | null; shortLiqUsd: number | null; oiUsd: number; lsarDirection: number }>;
  totals: OiDriverPayload["totals"]; sources: OiDriverSource[]; warnings: string[]; generatedAt: string;
};
type State = { payload: OiDriverPayload | null; loading: boolean; error: string | null };

export function useOiDriver(asset: string, timeframe: string, exchange: string, symbol: string,
  priceCandles: Candle[], enabled = true, settings = DEFAULT_OI_DRIVER_SETTINGS) {
  const [state, setState] = useState<State>({ payload: null, loading: false, error: null });
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry(value => value + 1), []);
  const prices = useMemo(() => new Map(priceCandles.map(bar => [bar.time, bar])), [priceCandles]);
  useEffect(() => {
    let active = true, timer: number | undefined;
    let controller: AbortController | undefined;
    if (!enabled || !asset || !exchange || !symbol) {
      setState({ payload: null, loading: false, error: null });
      return;
    }
    setState(current => ({ ...current, loading: !current.payload, error: null }));
    const load = async () => {
      controller = new AbortController();
      try {
        const query = new URLSearchParams({ asset, timeframe, exchange, symbol });
        const response = await fetch(`/api/indicators/open-interest-driver?${query}`, { signal: controller.signal });
        const body = await response.json() as Raw & { error?: string };
        if (!response.ok) throw new Error(body.error || "Aggregated OI feed unavailable.");
        if (body.asset !== asset || body.timeframe !== timeframe || body.symbol !== symbol ||
          !Array.isArray(body.candles) || !Array.isArray(body.sources)) throw new Error("OI indicator response did not match the selected chart.");
        const aligned = body.candles.map(row => {
          const time = row.time + Number(timeframe === "5m" ? 300 : timeframe === "15m" ? 900 : timeframe === "30m" ? 1800 :
            timeframe === "1h" ? 3600 : timeframe === "4h" ? 14400 : 86400);
          const price = prices.get(row.time);
          return { ...row, price: price ? { open: price.open, high: price.high, low: price.low, close: price.close } : null,
            cvd: row.cvd ?? null, longLiqUsd: row.longLiqUsd, shortLiqUsd: row.shortLiqUsd };
        });
        const calculated = calculateOiDriver(aligned, settings);
        const payload: OiDriverPayload = { asset, exchange, symbol, timeframe, candles: calculated,
          totals: body.totals, sources: body.sources, warnings: body.warnings, generatedAt: body.generatedAt };
        if (active) setState({ payload, loading: false, error: null });
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) setState(current => ({
          ...current, loading: false, error: error instanceof Error ? error.message : "Aggregated OI feed unavailable.",
        }));
      } finally {
        if (active) timer = window.setTimeout(load, 15_000);
      }
    };
    void load();
    return () => { active = false; controller?.abort(); window.clearTimeout(timer); };
  }, [asset, timeframe, exchange, symbol, prices, enabled, settings, retry]);
  return { ...state, refresh };
}
