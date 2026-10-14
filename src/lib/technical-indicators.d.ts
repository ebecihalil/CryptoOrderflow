export type TechnicalSettings = {
  emaPeriod: number;
  smaPeriod: number;
  bbPeriod: number;
  bbStdDev: number;
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
};
export type TechnicalPoint = { time: number; value: number };
export type TechnicalStudies = {
  ema: TechnicalPoint[];
  sma: TechnicalPoint[];
  bb: { upper: TechnicalPoint[]; middle: TechnicalPoint[]; lower: TechnicalPoint[] };
  rsi: TechnicalPoint[];
  macd: { macd: TechnicalPoint[]; signal: TechnicalPoint[]; histogram: TechnicalPoint[] };
};
export const DEFAULT_TECHNICAL_SETTINGS: Readonly<TechnicalSettings>;
export function validateTechnicalSettings(input?: Partial<TechnicalSettings>): TechnicalSettings;
export function calculateTechnicalIndicators(
  candles: Array<{ time: number; close: number }>,
  settings?: Partial<TechnicalSettings>,
): TechnicalStudies;
