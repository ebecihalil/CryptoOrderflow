export const CHART_STUDIES = [
  { id: 'rsi', label: 'RSI' },
  { id: 'macd', label: 'MACD' },
  { id: 'ema', label: 'EMA' },
  { id: 'sma', label: 'SMA' },
  { id: 'bb', label: 'Bollinger Bands' },
] as const;

export type ChartStudyId = (typeof CHART_STUDIES)[number]['id'];

export const SUPER_CHART_TIMEFRAMES = [
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '24h', label: '1D' },
] as const;
