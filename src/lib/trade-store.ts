// Shared trading UI state: connection (paper / real), order ticket, the order being drafted
// (shared by the ticket and the chart's draggable order / TP / SL lines) and the contract it targets.
import { useSyncExternalStore } from 'react';
import type { TradeTarget } from '@/hooks/use-trading';

export type Connection = 'none' | 'paper' | 'real';
export type OrderType = 'market' | 'limit' | 'stop' | 'stopLimit';
export type Draft = {
  side: 'Buy' | 'Sell'; type: OrderType; price: string; trigger: string; qty: string; unit: 'coin' | 'usdt';
  tpOn: boolean; tp: string; slOn: boolean; sl: string;
};
type State = { connection: Connection; ticketOpen: boolean; connectOpen: boolean; draft: Draft; target: TradeTarget | null };

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const savedConnection = read('trade-connection');
export const EMPTY_DRAFT: Draft = { side: 'Buy', type: 'limit', price: '', trigger: '', qty: '', unit: (read('trade-unit') as Draft['unit']) || 'coin',
  tpOn: false, tp: '', slOn: false, sl: '' };

function flipped(draft: Draft, side: 'Buy' | 'Sell', entry?: number | null): Draft {
  if (draft.side === side) return draft;
  const mirror = (value: string) => {
    const v = Number(value);
    if (!entry || !value || !Number.isFinite(v)) return value;
    const decimals = value.includes('.') ? value.split('.')[1].length : 0;
    const next = 2 * entry - v;
    return next > 0 ? next.toFixed(decimals) : '';
  };
  return { ...draft, side, tp: mirror(draft.tp), sl: mirror(draft.sl), tpOn: draft.tpOn && !!mirror(draft.tp), slOn: draft.slOn && !!mirror(draft.sl) };
}

let state: State = {
  connection: savedConnection === 'paper' || savedConnection === 'real' ? savedConnection : 'none',
  ticketOpen: read('trade-ticket-open') === '1', connectOpen: false, draft: EMPTY_DRAFT, target: null,
};
const listeners = new Set<() => void>();
function set(next: Partial<State>) {
  state = { ...state, ...next };
  if (next.connection !== undefined) write('trade-connection', next.connection);
  if (next.ticketOpen !== undefined) write('trade-ticket-open', next.ticketOpen ? '1' : '0');
  listeners.forEach((listener) => listener());
}

export const tradeStore = {
  get: () => state,
  connect: (connection: Connection) => set({ connection, connectOpen: false, ticketOpen: connection !== 'none' }),
  disconnect: () => set({ connection: 'none', ticketOpen: false }),
  setConnectOpen: (connectOpen: boolean) => set({ connectOpen }),
  setTicketOpen: (ticketOpen: boolean) => set({ ticketOpen }),
  setTarget: (target: TradeTarget | null) => {
    const same = state.target && target && state.target.exchange === target.exchange && state.target.symbol === target.symbol;
    if (same) return;
    // A new contract starts a fresh order (prices and amounts belong to the old one).
    set({ target, draft: { ...EMPTY_DRAFT, side: state.draft.side, type: state.draft.type, unit: state.draft.unit } });
  },
  setDraft: (patch: Partial<Draft>) => {
    if (patch.unit) write('trade-unit', patch.unit);
    set({ draft: { ...state.draft, ...patch } });
  },
  /** Change side; TP / SL already set are mirrored around the entry price to the other side. */
  setSide: (side: 'Buy' | 'Sell', entry?: number | null) => set({ draft: flipped(state.draft, side, entry) }),
  /** Buy / Sell buttons on the chart: open the ticket on that side. */
  openTicket: (side?: 'Buy' | 'Sell', entry?: number | null) =>
    set({ ticketOpen: true, ...(side ? { draft: { ...flipped(state.draft, side, entry), price: '' } } : {}) }),
};

export function useTradeStore<T>(select: (value: State) => T): T {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => select(state), () => select(state));
}
