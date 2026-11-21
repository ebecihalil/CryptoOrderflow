// Per-chart trading: Buy / Sell buttons under the symbol legend and the order / TP / SL,
// position and open-order lines for the contract this chart shows.
import { useCallback, useMemo, type ReactNode } from 'react';
import { useTradingAccount, useTradingActions, useTradingMarket, useTradingStatus, type TradeTarget, type TradingMode } from '@/hooks/use-trading';
import { tradeStore, useTradeStore } from '@/lib/trade-store';
import { orderPrice, stepDecimals } from '@/components/trade-ticket';
import type { TradeLine } from '@/components/trade-lines';

const BUY = '#2962ff', SELL = '#f23645', TP = '#089981', SL = '#f23645';
const TYPE_LABEL = { market: 'Market', limit: 'Limit', stop: 'Stop', stopLimit: 'Stop Limit' } as const;
const num = (value: string | null | undefined) => { const n = Number(value); return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? n : null; };
const compact = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 4 });
const signedUsd = (value: number) => `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`;

export function useChartTrade(contract: { exchange: string; symbol: string; asset: string } | null): { overlay: ReactNode; lines: TradeLine[] } {
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
        out.push({ id: 'draft', price: entry, color, dashed: true, text: `${coins === null ? '—' : compact(coins)} | ${TYPE_LABEL[type]}`,
          chip: { text: side, color }, draggable: type !== 'market', onDrag: (p) => tradeStore.setDraft({ [field]: fix(p) }), onCancel: () => tradeStore.setTicketOpen(false) });
        if (type === 'stopLimit' && num(trigger)) out.push({ id: 'draft-trigger', price: num(trigger)!, color, dashed: true, text: 'Stop trigger',
          draggable: true, onDrag: (p) => tradeStore.setDraft({ trigger: fix(p) }) });
        const tpPrice = num(tp), slPrice = num(sl);
        if (tpOn && tpPrice) {
          const v = pnl(tpPrice);
          out.push({ id: 'draft-tp', price: tpPrice, color: TP, dashed: true, text: `TP${v === null ? '' : ` ${signedUsd(v)}`}`, draggable: true,
            onDrag: (p) => tradeStore.setDraft({ tp: fix(p) }), onCancel: () => tradeStore.setDraft({ tpOn: false }) });
        } else out.push({ id: 'draft-tp', price: entry, ghostOffset: -26, color: TP, text: 'TP', draggable: true,
          onDrag: (p) => tradeStore.setDraft({ tpOn: true, tp: fix(p) }) });
        if (slOn && slPrice) {
          const v = pnl(slPrice);
          out.push({ id: 'draft-sl', price: slPrice, color: SL, dashed: true, text: `SL${v === null ? '' : ` ${signedUsd(v)}`}`, draggable: true,
            onDrag: (p) => tradeStore.setDraft({ sl: fix(p) }), onCancel: () => tradeStore.setDraft({ slOn: false }) });
        } else out.push({ id: 'draft-sl', price: entry, ghostOffset: 26, color: SL, text: 'SL', draggable: true,
          onDrag: (p) => tradeStore.setDraft({ slOn: true, sl: fix(p) }) });
      }
    }
    // ---- open positions: entry with PnL, TP / SL (drag to change; set on release) ----
    for (const position of account.data?.positions ?? []) {
      if (!mine(position)) continue;
      const entry = num(position.entryPrice), pnl = num(position.unrealisedPnl) ?? 0;
      if (!entry) continue;
      const ref = { exchange: position.exchange, asset: position.asset, symbol: position.symbol };
      const long = position.side === 'Buy';
      out.push({ id: `pos-${position.symbol}`, price: entry, color: long ? TP : SL, text: `${long ? 'Long' : 'Short'} ${position.size}`,
        chip: { text: signedUsd(pnl), color: pnl >= 0 ? TP : SL },
        onCancel: () => { if (window.confirm(`Close ${long ? 'LONG' : 'SHORT'} ${position.size} ${position.symbol} at market?`)) closePosition.mutate(ref); } });
      const size = num(position.size) ?? 0;
      const exitPnl = (p: number) => (long ? p - entry : entry - p) * size;
      const tpPrice = num(position.takeProfit), slPrice = num(position.stopLoss);
      if (tpPrice) out.push({ id: `pos-tp-${position.symbol}`, price: tpPrice, color: TP, dashed: true, text: `TP ${signedUsd(exitPnl(tpPrice))}`, draggable: true,
        onDrop: (p) => setTpsl.mutate({ ...ref, takeProfit: fix(p) }), onCancel: () => setTpsl.mutate({ ...ref, takeProfit: 0 }) });
      else out.push({ id: `pos-tp-${position.symbol}`, price: entry, ghostOffset: -26, color: TP, text: 'TP', draggable: true,
        onDrop: (p) => setTpsl.mutate({ ...ref, takeProfit: fix(p) }) });
      if (slPrice) out.push({ id: `pos-sl-${position.symbol}`, price: slPrice, color: SL, dashed: true, text: `SL ${signedUsd(exitPnl(slPrice))}`, draggable: true,
        onDrop: (p) => setTpsl.mutate({ ...ref, stopLoss: fix(p) }), onCancel: () => setTpsl.mutate({ ...ref, stopLoss: 0 }) });
      else out.push({ id: `pos-sl-${position.symbol}`, price: entry, ghostOffset: 26, color: SL, text: 'SL', draggable: true,
        onDrop: (p) => setTpsl.mutate({ ...ref, stopLoss: fix(p) }) });
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
  }, [connected, chartTarget, ticketOpen, isTarget, quote, draft, account.data, mine, fix, setTpsl, cancelOrder, closePosition]);

  const overlay = connected && quote ? (
    <div className="chart-trade-buttons" data-testid="chart-trade-buttons">
      <button type="button" className="is-sell" onClick={() => tradeStore.openTicket('Sell')}><b>{quote.bid ?? '—'}</b><small>SELL</small></button>
      {quote.bid && quote.ask && <span className="chart-trade-spread">{Math.max(0, Number(quote.ask) - Number(quote.bid)).toFixed(decimals)}</span>}
      <button type="button" className="is-buy" onClick={() => tradeStore.openTicket('Buy')}><b>{quote.ask ?? '—'}</b><small>BUY</small></button>
    </div>
  ) : null;
  return { overlay, lines };
}
