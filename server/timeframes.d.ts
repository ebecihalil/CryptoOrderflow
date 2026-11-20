export const CHART_TIMEFRAMES: string[];
export const TIMEFRAME_LABELS: Record<string, string>;
export function isTimeframe(value: unknown): boolean;
export function isCalendarTimeframe(tf: string): boolean;
export function timeframeSeconds(tf: string): number;
export function bucketStart(tf: string, seconds: number): number;
export function nextBucket(tf: string, start: number): number;
export function aggregateCandles<T extends { time: number; open: number; high: number; low: number; close: number; volume: number; closed?: boolean }>(
  candles: T[], tf: string, nowMs?: number): Array<{ time: number; open: number; high: number; low: number; close: number; volume: number; closed: boolean }>;
export function isContiguous(candles: Array<{ time: number }>, tf: string): boolean;
