import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** enabled = REAL trading (owner only); paper = paper trading (any signed-in user). */
export type TradingStatus = { enabled: boolean; paper?: boolean; exchange?: 'bybit'; testnet?: boolean };
export type TradingMode = 'real' | 'paper';
const api = (mode: TradingMode) => (mode === 'real' ? '/api/trading' : '/api/paper');
export type TradingMarket = {
  symbol: string; tickSize: string; qtyStep: string; minQty: string; maxQty: string; maxLeverage: number; base: string;
  bid: string | null; ask: string | null; last: string | null; mark: string | null; leverage: number | null;
};
export type TradingPosition = {
  symbol: string; side: 'Buy' | 'Sell'; size: string; entryPrice: string; markPrice: string; liqPrice: string | null; leverage: string;
  positionValue: string; unrealisedPnl: string; realisedPnl: string; takeProfit: string | null; stopLoss: string | null; margin: string | null;
};
export type TradingOrder = {
  orderId: string; symbol: string; side: 'Buy' | 'Sell'; orderType: string; price: string | null; triggerPrice?: string | null; qty: string;
  filled: string; status: string; reduceOnly: boolean; stopOrderType?: string | null; takeProfit?: string | null; stopLoss?: string | null;
  createdTime: number | null; updatedTime?: number | null;
};
export type TradingAccount = {
  testnet: boolean; paper?: boolean; startBalance?: number;
  balance: { equity: string | null; marginBalance: string | null; available: string | null; walletUsdt: string | null; unrealisedPnl: string | null };
  positions: TradingPosition[]; orders: TradingOrder[];
};
export type OrderInput = {
  symbol: string; side: 'Buy' | 'Sell'; type: 'market' | 'limit' | 'stop' | 'stopLimit'; qty: number; price?: number; triggerPrice?: number;
  leverage?: number; takeProfit?: number; stopLoss?: number; timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'PostOnly'; reduceOnly?: boolean;
};

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`);
  return data as T;
}

/** Trading is visible only to the owner account the server is configured for. */
export function useTradingStatus() {
  return useQuery({ queryKey: ['trading-status'], queryFn: () => send<TradingStatus>('GET', '/api/trading/status'), staleTime: 60_000, retry: 1 });
}

export function useTradingAccount(mode: TradingMode, enabled: boolean) {
  return useQuery({ queryKey: ['trading-account', mode], queryFn: () => send<TradingAccount>('GET', `${api(mode)}/account`),
    enabled, refetchInterval: 3000, refetchIntervalInBackground: false, retry: 1 });
}

export function useTradingHistory(mode: TradingMode, enabled: boolean) {
  return useQuery({ queryKey: ['trading-history', mode], queryFn: () => send<{ orders: TradingOrder[] }>('GET', `${api(mode)}/history`),
    enabled, refetchInterval: 15_000, retry: 1 });
}

export function useTradingMarket(mode: TradingMode, symbol: string | null, enabled: boolean) {
  return useQuery({ queryKey: ['trading-market', mode, symbol], queryFn: () => send<TradingMarket>('GET', `${api(mode)}/market?symbol=${encodeURIComponent(symbol ?? '')}`),
    enabled: enabled && !!symbol, refetchInterval: 2000, retry: false });
}

export function useTradingActions(mode: TradingMode) {
  const client = useQueryClient();
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ['trading-account'] }), client.invalidateQueries({ queryKey: ['trading-history'] }),
    client.invalidateQueries({ queryKey: ['trading-market'] })]);
  const action = <I,>(url: string) => useMutation({ mutationFn: (input: I) => send<{ orderId?: string }>('POST', url, input), onSettled: refresh });
  return {
    placeOrder: action<OrderInput>(`${api(mode)}/order`),
    cancelOrder: action<{ symbol: string; orderId: string }>(`${api(mode)}/cancel`),
    cancelAll: action<{ symbol?: string }>(`${api(mode)}/cancel-all`),
    closePosition: action<{ symbol: string; qty?: number; price?: number }>(`${api(mode)}/close`),
    setTpsl: action<{ symbol: string; takeProfit?: number | string; stopLoss?: number | string }>(`${api(mode)}/tpsl`),
    reset: action<Record<string, never>>('/api/paper/reset'),
  };
}
