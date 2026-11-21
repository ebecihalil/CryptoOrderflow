import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** enabled = REAL trading (owner only); paper = paper trading (any signed-in user). */
export type TradingStatus = { enabled: boolean; paper?: boolean; exchange?: 'bybit'; testnet?: boolean; admin?: boolean; bybit?: 'ready' | 'not-set-up' };
export type TradingMode = 'real' | 'paper';
const api = (mode: TradingMode) => (mode === 'real' ? '/api/trading' : '/api/paper');
/** The contract an order goes to: paper trades the chart's own exchange; real always Bybit. */
export type TradeTarget = { exchange: string; symbol: string; asset: string; label: string };
export type TradingMarket = {
  symbol: string; tickSize: string; qtyStep: string; minQty: string; maxQty: string; maxLeverage: number; base: string;
  bid: string | null; ask: string | null; last: string | null; mark: string | null; leverage: number | null; priceSource?: string | null;
};
export type TradingPosition = {
  exchange?: string; asset?: string | null;
  symbol: string; side: 'Buy' | 'Sell'; size: string; entryPrice: string; markPrice: string; liqPrice: string | null; leverage: string;
  positionValue: string; unrealisedPnl: string; realisedPnl: string; takeProfit: string | null; stopLoss: string | null; margin: string | null;
};
export type TradingOrder = {
  orderId: string; exchange?: string; symbol: string; side: 'Buy' | 'Sell'; orderType: string; price: string | null; triggerPrice?: string | null; qty: string;
  filled: string; status: string; reduceOnly: boolean; stopOrderType?: string | null; takeProfit?: string | null; stopLoss?: string | null;
  createdTime: number | null; updatedTime?: number | null;
};
export type PaperSettings = { startBalance: number; commission: boolean; marketFeePct: number; limitFeePct: number };
export type TradingAccount = {
  testnet: boolean; paper?: boolean; startBalance?: number; settings?: PaperSettings;
  balance: { equity: string | null; marginBalance: string | null; available: string | null; walletUsdt: string | null; unrealisedPnl: string | null };
  positions: TradingPosition[]; orders: TradingOrder[];
};
export type OrderInput = {
  exchange?: string; asset?: string; symbol: string; side: 'Buy' | 'Sell'; type: 'market' | 'limit' | 'stop' | 'stopLimit'; qty: number; price?: number; triggerPrice?: number;
  leverage?: number; takeProfit?: number; stopLoss?: number; timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'PostOnly'; reduceOnly?: boolean;
};
type ContractRef = { exchange?: string; asset?: string | null; symbol: string };

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

/** Trading is visible only to signed-in users; real trading only to the owner. */
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

export function useTradingMarket(mode: TradingMode, target: TradeTarget | null, enabled: boolean) {
  const query = target ? new URLSearchParams({ symbol: target.symbol, exchange: target.exchange, asset: target.asset }).toString() : '';
  return useQuery({ queryKey: ['trading-market', mode, query], queryFn: () => send<TradingMarket>('GET', `${api(mode)}/market?${query}`),
    enabled: enabled && !!target, refetchInterval: 2000, retry: false });
}

export function useTradingActions(mode: TradingMode) {
  const client = useQueryClient();
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ['trading-account'] }), client.invalidateQueries({ queryKey: ['trading-history'] }),
    client.invalidateQueries({ queryKey: ['trading-market'] })]);
  const placeOrder = useMutation({ mutationFn: (input: OrderInput) => send<{ orderId?: string }>('POST', `${api(mode)}/order`, input), onSettled: refresh });
  const cancelOrder = useMutation({ mutationFn: (input: ContractRef & { orderId: string }) => send('POST', `${api(mode)}/cancel`, input), onSettled: refresh });
  const cancelAll = useMutation({ mutationFn: (input: { symbol?: string }) => send('POST', `${api(mode)}/cancel-all`, input), onSettled: refresh });
  const closePosition = useMutation({ mutationFn: (input: ContractRef & { qty?: number; price?: number }) => send('POST', `${api(mode)}/close`, input), onSettled: refresh });
  const setTpsl = useMutation({ mutationFn: (input: ContractRef & { takeProfit?: number | string; stopLoss?: number | string }) => send('POST', `${api(mode)}/tpsl`, input), onSettled: refresh });
  const reset = useMutation({ mutationFn: () => send('POST', '/api/paper/reset', {}), onSettled: refresh });
  const saveSettings = useMutation({ mutationFn: (input: Partial<PaperSettings>) => send('POST', '/api/paper/settings', input), onSettled: refresh });
  return { placeOrder, cancelOrder, cancelAll, closePosition, setTpsl, reset, saveSettings };
}
