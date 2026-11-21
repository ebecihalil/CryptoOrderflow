export type MarketDriverSettings = {
  stateColors: boolean; showTotals: boolean; useLsr: boolean;
  flatBodyPct: number; flatActivityLength: number; flatActivityFactor: number;
  pinbarBodyPct: number; pinbarWickPct: number; pinbarWickRatio: number;
  spikeMult: number; avgLength: number; maxSidewaysBars: number; pullback1: number; pullback2: number;
};
export type MarketDriverBar = {
  time: number; open: number; high: number; low: number; close: number;
  color: string; bodyColor: string; stateColor: string; state: string; driverTop: string; driverBottom: string;
  bullId: number; bearId: number; pullback1: boolean; pullback2: boolean; buyPct: number | null; sellPct: number | null;
};
export type MarketDriverLabel = { time: number; value: number; text: string; color: string };
export const MARKET_DRIVER_DEFAULTS: MarketDriverSettings;
export const MARKET_DRIVER_COLORS: Record<string, string>;
export function calculateMarketDriver(bars: unknown[], settings?: Partial<MarketDriverSettings>, colors?: Record<string, string>):
  { bars: Array<MarketDriverBar | null>; labels: MarketDriverLabel[] };
