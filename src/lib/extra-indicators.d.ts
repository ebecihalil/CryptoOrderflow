export type ExtraPoint = { time: number; value: number | null; color?: string };
export type ExtraSeries = {
  key: string; label: string; color: string; type: 'line' | 'histogram' | 'dots';
  width?: number; dashed?: boolean; step?: boolean; hidden?: boolean; data: ExtraPoint[];
};
export type ExtraResult = {
  series: ExtraSeries[];
  fills?: Array<{ upper: string; lower: string; up: string; down: string }>;
  levels?: Array<{ value: number; label?: string }>;
  range?: [number, number];
  /** Short legend text instead of per-series values. */
  summary?: string;
};
export type ExtraParam = { key: string; label: string; default: number; min: number; max: number; step: number };
export type ExtraIndicatorId = string;
export type ExtraIndicator = {
  id: ExtraIndicatorId; label: string; group: string; placement: 'overlay' | 'pane';
  params: ExtraParam[]; paneHeight?: number;
  compute(candles: ExtraCandle[], params: Record<string, number>): ExtraResult;
};
export type ExtraCandle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
export const EXTRA_INDICATORS: ExtraIndicator[];
export const EXTRA_INDICATOR_IDS: ExtraIndicatorId[];
export function extraIndicator(id: string): ExtraIndicator | null;
export function extraParams(id: string, saved?: Record<string, number>): Record<string, number>;
export function computeExtraIndicator(id: string, candles: ExtraCandle[], saved?: Record<string, number>): ExtraResult | null;
