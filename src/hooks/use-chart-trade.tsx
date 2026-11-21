// Per-chart trading: Buy / Sell buttons under the symbol legend and the order / TP / SL,
// position and open-order lines for the contract this chart shows.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTradingAccount, useTradingActions, useTradingMarket, useTradingStatus, type TradeTarget, type TradingMode } from '@/hooks/use-trading';
import { tradeStore, useTradeStore } from '@/lib/trade-store';
import { orderPrice, stepDecimals } from '@/components/trade-ticket';
import { TradeConfirm, type TradeLine } from '@/components/trade-lines';

const BUY = '#2962ff', SELL = '#f23645', TP = '#089981', SL = '#f23645';
const TYPE_LABEL = { market: 'Market', limit: 'Limit', stop: 'Stop', stopLimit: 'Stop Limit' } as const;
const num = (value: string | null | undefined) => { const n = Number(value); return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? n : null; };
const compact = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 4 });
const signedUsd = (value: number) => `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`;

export function useChartTrade(contract: { exchange: string; symbol: string; asset: string } | null): { overlay: ReactNode; lines: TradeLine[]; confirm: ReactNode } {
  const status = useTradingStatus();
  const connection = useTradeStore((s) => s.connection);
  const ticketOpen = useTradeStore((s) => s.ticketOpen);
  const draft = useTradeStore((s) => s.draft);
  const target = useTradeStore((s) => s.target);
  const canReal = !!status.data?.enabled, signedIn = canReal || !!status.data?.paper;
  const connected = signedIn && (connection === 'paper' || (connection === 'real' && canReal));
  const mode: TradingMode = connection === 'real' && canReal ? 'real' : 'paper';
  const exchange = contract?.exchange.toLowerCase() ?? '';
  // This chart's contract as an order target (real trading always goes to the coin's Bybit contract).
  const chartTarget = useMemo<TradeTarget | null>(() => !contract ? null : mode === 'paper'
    ? { exchange, symbol: contract.symbol, asset: contract.asset, label: exchange }
    : { exchange: 'bybit', symbol: exchange === 'bybit' ? contract.symbol : `${contract.asset}USDT`, asset: contract.asset, label: 'Bybit' }, [contract, exchange, mode]);
  const market = useTradingMarket(mode, chartTarget, connected);
  const account = useTradingAccount(mode, connected);
  const { setTpsl, cancelOrder, closePosition } = useTradingActions(mode);
  const quote = market.data;
  const decimals = quote ? stepDecimals(quote.tickSize) : 4;
  const fix = useCallback((price: number) => price.toFixed(decimals), [decimals]);
  const isTarget = !!target && !!chartTarget && target.exchange === chartTarget.exchange && target.symbol === chartTarget.symbol;
  const mine = useCallback((item: { exchange?: string; symbol: string }) => !!chartTarget && item.symbol === chartTarget.symbol &&
    (mode === 'real' || (item.exchange ?? 'bybit') === chartTarget.exchange), [chartTarget, mode]);

  // TP / SL changes on an open position wait for Confirm (centre of the chart).
  const [pending, setPending] = useState<{ ref: { exchange?: string; asset?: string | null; symbol: string }; takeProfit?: string; stopLoss?: string } | null>(null);
  const propose = (ref: { exchange?: string; asset?: string | null; symbol: string }, change: { takeProfit?: string; stopLoss?: string }) =>
    setPending((current) => current && current.ref.symbol === ref.symbol && current.ref.exchange === ref.exchange ? { ...current, ...change } : { ref, ...change });

  const lines = useMemo<TradeLine[]>(() => {
    if (!connected || !chartTarget) return [];
    const out: TradeLine[] = [];
    // ---- the order being drafted in the ticket ----
    if (ticketOpen && isTarget && quote) {
      const { side, type, price, trigger, qty, unit, tpOn, tp, slOn, sl } = draft;
      const entry = orderPrice(type, side, price, trigger, quote);
      if (entry) {
        const amount = num(qty);
        const coins = amount === null ? null : unit === 'usdt' ? amount / entry : amount;
        const color = side === 'Buy' ? BUY : SELL;
        const pnl = (target: number) => coins === null ? null : (side === 'Buy' ? target - entry : entry - target) * coins;
        const field = type === 'stop' ? 'trigger' : 'price';
        const tpPrice = num(tp), slPrice = num(sl);
        const tpActive = tpOn && !!tpPrice, slActive = slOn && !!slPrice;
        out.push({ id: 'draft', price: entry, color, dashed: true, text: `${coins === null ? '—' : compact(coins)} | ${TYPE_LABEL[type]}`,
          chip: { text: side, color }, draggable: type !== 'market', onDrag: (p) => tradeStore.setDraft({ [field]: fix(p) }), onCancel: () => tradeStore.setTicketOpen(false),
          // Inactive TP / SL wait on the order line; dragging one away activates it.
          handles: [
            ...(tpActive ? [] : [{ id: 'draft-tp-handle', text: 'TP', color: TP, onDrop: (p: number) => tradeStore.setDraft({ tpOn: true, tp: fix(p) }) }]),
            ...(slActive ? [] : [{ id: 'draft-sl-handle', text: 'SL', color: SL, onDrop: (p: number) => tradeStore.setDraft({ slOn: true, sl: fix(p) }) }]),
          ] });
        if (type === 'stopLimit' && num(trigger)) out.push({ id: 'draft-trigger', price: num(trigger)!, color, dashed: true, text: 'Stop trigger',
          draggable: true, onDrag: (p) => tradeStore.setDraft({ trigger: fix(p) }) });
        if (tpActive) {
          const v = pnl(tpPrice!);
          out.push({ id: 'draft-tp', price: tpPrice!, color: TP, filled: true, dashed: true, text: `TP${v === null ? '' : ` ${signedUsd(v)}`}`, draggable: true,
            onDrag: (p) => tradeStore.setDraft({ tp: fix(p) }), onCancel: () => tradeStore.setDraft({ tpOn: false }) });
        }
        if (slActive) {
          const v = pnl(slPrice!);
          out.push({ id: 'draft-sl', price: slPrice!, color: SL, filled: true, dashed: true, text: `SL${v === null ? '' : ` ${signedUsd(v)}`}`, draggable: true,
            onDrag: (p) => tradeStore.setDraft({ sl: fix(p) }), onCancel: () => tradeStore.setDraft({ slOn: false }) });
        }
      }
    }
    // ---- open positions: entry with PnL; TP / SL handles on the line, changes confirmed in the middle ----
    for (const position of account.data?.positions ?? []) {
      if (!mine(position)) continue;
      const entry = num(position.entryPrice), pnl = num(position.unrealisedPnl) ?? 0;
      if (!entry) continue;
      const ref = { exchange: position.exchange, asset: position.asset, symbol: position.symbol };
      const long = position.side === 'Buy';
      const size = num(position.size) ?? 0;
      const exitPnl = (p: number) => (long ? p - entry : entry - p) * size;
      const wait = pending && pending.ref.symbol === position.symbol && pending.ref.exchange === position.exchange ? pending : null;
      // Shown TP / SL: a pending change wins over the saved one ("0" = removed).
      const tpPrice = num(wait?.takeProfit !== undefined ? wait.takeProfit : position.takeProfit) || null;
      const slPrice = num(wait?.stopLoss !== undefined ? wait.stopLoss : position.stopLoss) || null;
      out.push({ id: `pos-${position.symbol}`, price: entry, color: long ? TP : SL, text: `${long ? 'Long' : 'Short'} ${position.size}`,
        chip: { text: signedUsd(pnl), color: pnl >= 0 ? TP : SL },
        onCancel: () => { if (window.confirm(`Close ${long ? 'LONG' : 'SHORT'} ${position.size} ${position.symbol} at market?`)) closePosition.mutate(ref); },
        handles: [
          ...(tpPrice ? [] : [{ id: `pos-tp-handle-${position.symbol}`, text: 'TP', color: TP, onDrop: (p: number) => propose(ref, { takeProfit: fix(p) }) }]),
          ...(slPrice ? [] : [{ id: `pos-sl-handle-${position.symbol}`, text: 'SL', color: SL, onDrop: (p: number) => propose(ref, { stopLoss: fix(p) }) }]),
        ] });
      if (tpPrice) out.push({ id: `pos-tp-${position.symbol}`, price: tpPrice, color: TP, filled: true, dashed: true, text: `TP ${signedUsd(exitPnl(tpPrice))}`, draggable: true,
        onDrop: (p) => propose(ref, { takeProfit: fix(p) }), onCancel: () => propose(ref, { takeProfit: '0' }) });
      if (slPrice) out.push({ id: `pos-sl-${position.symbol}`, price: slPrice, color: SL, filled: true, dashed: true, text: `SL ${signedUsd(exitPnl(slPrice))}`, draggable: true,
        onDrop: (p) => propose(ref, { stopLoss: fix(p) }), onCancel: () => propose(ref, { stopLoss: '0' }) });
    }
    // ---- open orders ----
    for (const order of account.data?.orders ?? []) {
      if (!mine(order)) continue;
      const price = num(order.price) ?? num(order.triggerPrice ?? null);
      if (!price) continue;
      out.push({ id: `ord-${order.orderId}`, price, color: order.side === 'Buy' ? BUY : SELL, dashed: true,
        text: `${order.qty} | ${order.triggerPrice ? 'Stop ' : ''}${order.orderType}${order.reduceOnly ? ' · RO' : ''}`, chip: { text: order.side, color: order.side === 'Buy' ? BUY : SELL },
        onCancel: () => cancelOrder.mutate({ exchange: order.exchange, symbol: order.symbol, orderId: order.orderId }) });
    }
    return out;
  }, [connected, chartTarget, ticketOpen, isTarget, quote, draft, account.data, mine, fix, pending, cancelOrder, closePosition]);

  const overlay = connected && quote ? (
    <div className="chart-trade-buttons" data-testid="chart-trade-buttons">
      <button type="button" className="is-sell" onClick={() => tradeStore.openTicket('Sell', ticketOpen ? orderPrice(draft.type, draft.side, draft.price, draft.trigger, quote) : null)}><b>{quote.bid ?? '—'}</b><small>SELL</small></button>
      {quote.bid && quote.ask && <span className="chart-trade-spread">{Math.max(0, Number(quote.ask) - Number(quote.bid)).toFixed(decimals)}</span>}
      <button type="button" className="is-buy" onClick={() => tradeStore.openTicket('Buy', ticketOpen ? orderPrice(draft.type, draft.side, draft.price, draft.trigger, quote) : null)}><b>{quote.ask ?? '—'}</b><small>BUY</small></button>
    </div>
  ) : null;
  const describe = (label: string, value: string | undefined) => value === undefined ? null : `${label} ${value === '0' ? 'removed' : value}`;
  const confirm = pending ? <TradeConfirm busy={setTpsl.isPending}
    text={`${pending.ref.symbol}: ${[describe('TP', pending.takeProfit), describe('SL', pending.stopLoss)].filter(Boolean).join(' · ')}`}
    onCancel={() => setPending(null)}
    onConfirm={() => setTpsl.mutate({ ...pending.ref, ...(pending.takeProfit !== undefined ? { takeProfit: pending.takeProfit } : {}),
      ...(pending.stopLoss !== undefined ? { stopLoss: pending.stopLoss } : {}) }, { onSuccess: () => setPending(null), onError: (error) => window.alert(error.message) })} /> : null;
  return { overlay, lines, confirm };
}
