export const CHART_EXCHANGES = [
  { id: 'BINANCE', label: 'Binance' },
  { id: 'BYBIT', label: 'Bybit' },
  { id: 'OKX', label: 'OKX' },
] as const;

export type ChartExchange = (typeof CHART_EXCHANGES)[number]['id'];

export const CHART_INTERVALS = [
  { value: '5', label: '5m' },
  { value: '15', label: '15m' },
  { value: '30', label: '30m' },
  { value: '60', label: '1h' },
  { value: '240', label: '4h' },
  { value: '1D', label: '1D' },
] as const;

export const CHART_STUDIES = [
  { id: 'rsi', label: 'RSI', widgetId: 'RSI@tv-basicstudies' },
  { id: 'macd', label: 'MACD', widgetId: 'MACD@tv-basicstudies' },
  { id: 'ema', label: 'EMA', widgetId: 'MAExp@tv-basicstudies' },
  { id: 'sma', label: 'SMA', widgetId: 'MASimple@tv-basicstudies' },
  { id: 'bb', label: 'Bollinger Bands', widgetId: 'BB@tv-basicstudies' },
] as const;

export type ChartStudyId = (typeof CHART_STUDIES)[number]['id'];

export type AdvancedChartConfig = {
  autosize: true;
  symbol: string;
  interval: string;
  timezone: 'Etc/UTC';
  theme: 'light' | 'dark';
  style: '1';
  locale: 'en';
  allow_symbol_change: true;
  hide_top_toolbar: false;
  hide_side_toolbar: false;
  studies: string[];
  support_host: 'https://www.tradingview.com';
};

export function normalizePerpetualTicker(input: string): string {
  const clean = input.trim().toUpperCase().replace(/\s+/g, '');
  if (!clean) return 'BTCUSDT';
  return clean.endsWith('.P') ? clean.slice(0, -2) : clean;
}

export function buildChartSymbol(exchange: ChartExchange, ticker: string): string {
  return `${exchange}:${normalizePerpetualTicker(ticker)}.P`;
}

export function buildAdvancedChartConfig(options: {
  exchange: ChartExchange;
  ticker: string;
  interval: string;
  theme: 'light' | 'dark';
  studies: ChartStudyId[];
}): AdvancedChartConfig {
  return {
    autosize: true,
    symbol: buildChartSymbol(options.exchange, options.ticker),
    interval: options.interval,
    timezone: 'Etc/UTC',
    theme: options.theme,
    style: '1',
    locale: 'en',
    allow_symbol_change: true,
    hide_top_toolbar: false,
    hide_side_toolbar: false,
    studies: CHART_STUDIES.filter((study) => options.studies.includes(study.id)).map((study) => study.widgetId),
    support_host: 'https://www.tradingview.com',
  };
}
