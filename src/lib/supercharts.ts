import { EXTRA_INDICATORS, type ExtraIndicatorId } from './extra-indicators.js';

type BaseStudyId = 'rsi' | 'macd' | 'ema' | 'sma' | 'bb';
export type ChartStudyId = BaseStudyId | ExtraIndicatorId;
export type ChartStudy = { id: ChartStudyId; label: string; group: string };

/** Original studies plus the popular-indicator registry, grouped for the menu. */
export const CHART_STUDIES: ChartStudy[] = [
  { id: 'ema', label: 'EMA', group: 'Moving averages' },
  { id: 'sma', label: 'SMA', group: 'Moving averages' },
  { id: 'bb', label: 'Bollinger Bands', group: 'Bands & channels' },
  { id: 'rsi', label: 'RSI', group: 'Oscillators' },
  { id: 'macd', label: 'MACD', group: 'Oscillators' },
  ...EXTRA_INDICATORS.map((def) => ({ id: def.id, label: def.label, group: def.group })),
];
export const CHART_STUDY_GROUPS = ['Moving averages', 'Bands & channels', 'Trend', 'Oscillators', 'Trend strength & volatility', 'Volume'];

export const SUPER_CHART_TIMEFRAMES = [
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '24h', label: '1D' },
] as const;
