// Bottom panel: account balance, open positions, open orders and order history (owner's Bybit account).
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import '@/styles/trading.css';
import { useTradingActions, useTradingHistory, type TradingAccount, type TradingMode, type TradingPosition } from '@/hooks/use-trading';

const n = (value: string | number | null | undefined) => { const v = Number(value); return Number.isFinite(v) ? v : null; };
const money = (value: string | number | null | undefined) => { const v = n(value); return v === null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }); };
const signed = (value: string | number | null | undefined) => { const v = n(value); return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`; };
const time = (ms: number | null | undefined) => ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
type Tab = 'positions' | 'orders' | 'history';

function PositionRow({ mode, position, onSymbol }: { mode: TradingMode; position: TradingPosition; onSymbol?: (symbol: string) => void }) {
  const { closePosition, setTpsl } = useTradingActions(mode);
  const [tp, setTp] = useState(position.takeProfit ?? '');
  const [sl, setSl] = useState(position.stopLoss ?? '');
  const [error, setError] = useState<string | null>(null);
  const pnl = n(position.unrealisedPnl), margin = n(position.margin);
  const roe = pnl !== null && margin ? pnl / margin * 100 : null;
  const close = () => {
    if (!window.confirm(`Close ${position.side === 'Buy' ? 'LONG' : 'SHORT'} ${position.size} ${position.symbol} at market?`)) return;
    closePosition.mutate({ symbol: position.symbol }, { onError: (e) => setError(e.message) });
  };
  const saveTpsl = () => setTpsl.mutate({ symbol: position.symbol, takeProfit: tp || 0, stopLoss: sl || 0 },
    { onError: (e) => setError(e.message), onSuccess: () => setError(null) });
  return (
    <tr>
      <td><button type="button" className="trade-link" onClick={() => onSymbol?.(position.symbol)}>{position.symbol}</button></td>
      <td className={position.side === 'Buy' ? 'is-up' : 'is-down'}>{position.side === 'Buy' ? 'Long' : 'Short'} {position.leverage}x</td>
      <td>{position.size}</td><td>{money(position.positionValue)}</td><td>{position.entryPrice}</td><td>{position.markPrice}</td>
      <td>{position.liqPrice ?? '—'}</td>
      <td className={(pnl ?? 0) >= 0 ? 'is-up' : 'is-down'}>{signed(pnl)}{roe !== null && <small> ({roe > 0 ? '+' : ''}{roe.toFixed(2)}%)</small>}</td>
      <td className="trade-tpsl">
        <input value={tp} onChange={(e) => setTp(e.target.value)} placeholder="TP" aria-label="Take profit" />
        <input value={sl} onChange={(e) => setSl(e.target.value)} placeholder="SL" aria-label="Stop loss" />
        <button type="button" onClick={saveTpsl} disabled={setTpsl.isPending}>Set</button>
      </td>
      <td><button type="button" className="trade-close" onClick={close} disabled={closePosition.isPending}>Close</button>
        {error && <small className="is-down" title={error}> ⚠ {error}</small>}</td>
    </tr>
  );
}

export function TradeAccountPanel({ mode, account, error, testnet, collapsed, onToggle, onSymbol }: {
  mode: TradingMode; account: TradingAccount | undefined; error: Error | null; testnet: boolean; collapsed: boolean; onToggle: () => void; onSymbol?: (symbol: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('positions');
  const history = useTradingHistory(mode, !collapsed && tab === 'history');
  const { cancelOrder, cancelAll, reset } = useTradingActions(mode);
  const [actionError, setActionError] = useState<string | null>(null);
  const balance = account?.balance;
  const upl = n(balance?.unrealisedPnl);
  return (
    <section className={`trade-panel${collapsed ? ' is-collapsed' : ''}`} aria-label="Bybit account" data-testid="trade-panel">
      <header className="trade-panel-bar">
        <span className="trade-ticket-venue">BYBIT</span>
        {mode === 'paper' ? <span className="trade-paper">PAPER</span> : testnet ? <span className="trade-testnet">TESTNET</span> : <span className="trade-real">REAL</span>}
        <span>{mode === 'paper' ? 'Paper trading account' : 'Unified Trading Account'}</span>
        <span>Equity <b>{money(balance?.equity)}</b></span>
        <span>Margin balance <b>{money(balance?.marginBalance)}</b></span>
        <span>Available <b>{money(balance?.available)}</b></span>
        <span>Unrealized PnL <b className={(upl ?? 0) >= 0 ? 'is-up' : 'is-down'}>{signed(upl)}</b></span>
        {error && <span className="is-down">{error.message}</span>}
        {mode === 'paper' && <button type="button" className="trade-close trade-reset" disabled={reset.isPending}
          onClick={() => window.confirm(`Reset your paper account to ${(account?.startBalance ?? 10000).toLocaleString()} USDT? Positions, orders and history are cleared.`) && reset.mutate({})}>Reset</button>}
        <button type="button" className="trade-icon trade-collapse" onClick={onToggle} aria-label={collapsed ? 'Show account panel' : 'Hide account panel'}>
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
      </header>
      {!collapsed && <>
        <div className="trade-panel-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'positions'} className={tab === 'positions' ? 'is-on' : ''} onClick={() => setTab('positions')}>
            Positions {account?.positions.length ? <i>{account.positions.length}</i> : null}</button>
          <button type="button" role="tab" aria-selected={tab === 'orders'} className={tab === 'orders' ? 'is-on' : ''} onClick={() => setTab('orders')}>
            Orders {account?.orders.length ? <i>{account.orders.length}</i> : null}</button>
          <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'is-on' : ''} onClick={() => setTab('history')}>Order history</button>
          {tab === 'orders' && !!account?.orders.length && <button type="button" className="trade-close trade-cancel-all"
            onClick={() => window.confirm('Cancel ALL open orders?') && cancelAll.mutate({}, { onError: (e) => setActionError(e.message) })}>Cancel all</button>}
          {actionError && <span className="is-down">{actionError}</span>}
        </div>
        <div className="trade-panel-body">
          {tab === 'positions' && (account?.positions.length ? <table className="trade-table">
            <thead><tr><th>Symbol</th><th>Side</th><th>Size</th><th>Value</th><th>Entry</th><th>Mark</th><th>Liq.</th><th>Unrealized PnL</th><th>TP / SL</th><th /></tr></thead>
            <tbody>{account.positions.map((position) => <PositionRow key={`${position.symbol}-${position.side}`} mode={mode} position={position} onSymbol={onSymbol} />)}</tbody>
          </table> : <p className="trade-empty">No open positions.</p>)}
          {tab === 'orders' && (account?.orders.length ? <table className="trade-table">
            <thead><tr><th>Symbol</th><th>Side</th><th>Type</th><th>Price</th><th>Trigger</th><th>Qty</th><th>Filled</th><th>TP / SL</th><th>Status</th><th>Placed</th><th /></tr></thead>
            <tbody>{account.orders.map((order) => <tr key={order.orderId}>
              <td><button type="button" className="trade-link" onClick={() => onSymbol?.(order.symbol)}>{order.symbol}</button></td>
              <td className={order.side === 'Buy' ? 'is-up' : 'is-down'}>{order.side}{order.reduceOnly ? ' · RO' : ''}</td>
              <td>{order.stopOrderType ? `${order.stopOrderType} ` : ''}{order.orderType}</td><td>{order.price ?? 'Market'}</td><td>{order.triggerPrice ?? '—'}</td>
              <td>{order.qty}</td><td>{order.filled}</td><td>{order.takeProfit ?? '—'} / {order.stopLoss ?? '—'}</td><td>{order.status}</td><td>{time(order.createdTime)}</td>
              <td><button type="button" className="trade-close" onClick={() => cancelOrder.mutate({ symbol: order.symbol, orderId: order.orderId },
                { onError: (e) => setActionError(e.message) })}>Cancel</button></td>
            </tr>)}</tbody>
          </table> : <p className="trade-empty">No open orders.</p>)}
          {tab === 'history' && (history.data?.orders.length ? <table className="trade-table">
            <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Type</th><th>Avg price</th><th>Qty</th><th>Filled</th><th>Status</th></tr></thead>
            <tbody>{history.data.orders.map((order) => <tr key={order.orderId}>
              <td>{time(order.updatedTime ?? order.createdTime)}</td><td>{order.symbol}</td>
              <td className={order.side === 'Buy' ? 'is-up' : 'is-down'}>{order.side}{order.reduceOnly ? ' · RO' : ''}</td>
              <td>{order.orderType}</td><td>{order.price ?? '—'}</td><td>{order.qty}</td><td>{order.filled}</td><td>{order.status}</td>
            </tr>)}</tbody>
          </table> : <p className="trade-empty">{history.isLoading ? 'Loading…' : history.error ? (history.error as Error).message : 'No orders in the last 7 days.'}</p>)}
        </div>
      </>}
    </section>
  );
}
