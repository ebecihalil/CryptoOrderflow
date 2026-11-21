// Bottom panel: account balance, open positions, open orders and order history.
// Paper trading: settings (starting balance, commission) and Exit; real: the owner's Bybit account.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, LogOut, Settings } from 'lucide-react';
import '@/styles/trading.css';
import { useTradingActions, useTradingHistory, type TradingAccount, type TradingMode, type TradingPosition, type PaperSettings } from '@/hooks/use-trading';
import { ExchangeLogo } from '@/components/exchange-logo';

const n = (value: string | number | null | undefined) => { const v = Number(value); return value !== null && value !== undefined && Number.isFinite(v) ? v : null; };
const money = (value: string | number | null | undefined) => { const v = n(value); return v === null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }); };
const signed = (value: string | number | null | undefined) => { const v = n(value); return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`; };
const time = (ms: number | null | undefined) => ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
type Tab = 'positions' | 'orders' | 'history';
export type OpenContract = (exchange: string, symbol: string) => void;

function Venue({ exchange }: { exchange?: string }) {
  return exchange ? <span className="trade-row-venue"><ExchangeLogo exchange={exchange} /></span> : null;
}

function PositionRow({ mode, position, onSymbol }: { mode: TradingMode; position: TradingPosition; onSymbol?: OpenContract }) {
  const { closePosition, setTpsl } = useTradingActions(mode);
  const [tp, setTp] = useState(position.takeProfit ?? '');
  const [sl, setSl] = useState(position.stopLoss ?? '');
  const [error, setError] = useState<string | null>(null);
  // Follow TP / SL changed elsewhere (dragged on the chart).
  useEffect(() => { setTp(position.takeProfit ?? ''); }, [position.takeProfit]);
  useEffect(() => { setSl(position.stopLoss ?? ''); }, [position.stopLoss]);
  const pnl = n(position.unrealisedPnl), margin = n(position.margin);
  const roe = pnl !== null && margin ? pnl / margin * 100 : null;
  const ref = { exchange: position.exchange, asset: position.asset, symbol: position.symbol };
  const close = () => {
    if (!window.confirm(`Close ${position.side === 'Buy' ? 'LONG' : 'SHORT'} ${position.size} ${position.symbol} at market?`)) return;
    closePosition.mutate(ref, { onError: (e) => setError(e.message) });
  };
  const saveTpsl = () => setTpsl.mutate({ ...ref, takeProfit: tp || 0, stopLoss: sl || 0 },
    { onError: (e) => setError(e.message), onSuccess: () => setError(null) });
  return (
    <tr>
      <td><button type="button" className="trade-link" onClick={() => onSymbol?.(position.exchange ?? 'bybit', position.symbol)}>
        <Venue exchange={position.exchange} />{position.symbol}</button></td>
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

function PaperSettingsForm({ settings, onDone }: { settings: PaperSettings; onDone: () => void }) {
  const { saveSettings } = useTradingActions('paper');
  const [balance, setBalance] = useState(String(settings.startBalance));
  const [commission, setCommission] = useState(settings.commission);
  const [marketFee, setMarketFee] = useState(String(settings.marketFeePct));
  const [limitFee, setLimitFee] = useState(String(settings.limitFeePct));
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const changedBalance = Number(balance) !== settings.startBalance;
    if (changedBalance && !window.confirm(`Start again with ${Number(balance).toLocaleString()} USDT? Open positions, orders and history are cleared.`)) return;
    saveSettings.mutate({ startBalance: Number(balance), commission, marketFeePct: Number(marketFee), limitFeePct: Number(limitFee) },
      { onSuccess: onDone, onError: (e) => setError(e.message) });
  };
  return (
    <div className="trade-settings" role="dialog" aria-label="Paper trading settings" data-testid="paper-settings">
      <label className="trade-field"><span>Account size (USDT)</span>
        <div className="trade-input"><input type="number" min="10" step="100" value={balance} onChange={(e) => setBalance(e.target.value)} aria-label="Account size" /><em>USDT</em></div></label>
      <label className="trade-switch"><input type="checkbox" checked={commission} onChange={(e) => setCommission(e.target.checked)} /> Charge commission</label>
      <div className="trade-settings-fees">
        <label className="trade-field"><span>Market order fee</span>
          <div className="trade-input"><input type="number" min="0" max="1" step="0.005" value={marketFee} disabled={!commission} onChange={(e) => setMarketFee(e.target.value)} aria-label="Market fee percent" /><em>%</em></div></label>
        <label className="trade-field"><span>Limit order fee</span>
          <div className="trade-input"><input type="number" min="0" max="1" step="0.005" value={limitFee} disabled={!commission} onChange={(e) => setLimitFee(e.target.value)} aria-label="Limit fee percent" /><em>%</em></div></label>
      </div>
      <p className="trade-settings-note">A new account size starts the paper account again. Fees are a % of the trade value.</p>
      {error && <p className="trade-msg is-error">{error}</p>}
      <div className="trade-settings-actions">
        <button type="button" className="trade-close" onClick={onDone}>Cancel</button>
        <button type="button" className="trade-save" onClick={save} disabled={saveSettings.isPending}>Save</button>
      </div>
    </div>
  );
}

export function TradeAccountPanel({ mode, account, error, testnet, collapsed, onToggle, onSymbol, onExit }: {
  mode: TradingMode; account: TradingAccount | undefined; error: Error | null; testnet: boolean; collapsed: boolean; onToggle: () => void;
  onSymbol?: OpenContract; onExit: () => void;
}) {
  const [tab, setTab] = useState<Tab>('positions');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const history = useTradingHistory(mode, !collapsed && tab === 'history');
  const { cancelOrder, cancelAll, reset } = useTradingActions(mode);
  const [actionError, setActionError] = useState<string | null>(null);
  const balance = account?.balance;
  const upl = n(balance?.unrealisedPnl);
  const paper = mode === 'paper';
  return (
    <section className={`trade-panel${collapsed ? ' is-collapsed' : ''}`} aria-label={paper ? 'Paper trading account' : 'Bybit account'} data-testid="trade-panel">
      <header className="trade-panel-bar">
        {paper ? <strong className="trade-panel-title"><span className="trade-paper">PAPER</span> Paper Trading</strong>
          : <strong className="trade-panel-title"><ExchangeLogo exchange="bybit" /> Bybit {testnet ? <span className="trade-testnet">TESTNET</span> : <span className="trade-real">REAL</span>}</strong>}
        <span>Equity <b>{money(balance?.equity)}</b></span>
        <span>Available <b>{money(balance?.available)}</b></span>
        <span>Unrealized PnL <b className={(upl ?? 0) >= 0 ? 'is-up' : 'is-down'}>{signed(upl)}</b></span>
        {paper && account?.settings && <span>Commission <b>{account.settings.commission ? `${account.settings.marketFeePct}% / ${account.settings.limitFeePct}%` : 'off'}</b></span>}
        {error && <span className="is-down">{error.message}</span>}
        <span className="trade-panel-actions">
          {paper && <button type="button" className="trade-icon" onClick={() => setSettingsOpen((open) => !open)} aria-label="Paper trading settings" title="Settings"
            data-testid="paper-settings-button"><Settings size={15} /></button>}
          {paper && <button type="button" className="trade-close" disabled={reset.isPending}
            onClick={() => window.confirm(`Reset your paper account to ${(account?.settings?.startBalance ?? 10000).toLocaleString()} USDT? Positions, orders and history are cleared.`) && reset.mutate()}>Reset</button>}
          <button type="button" className="trade-close trade-exit-button" onClick={onExit} data-testid="trade-exit">
            <LogOut size={12} aria-hidden="true" /> {paper ? 'Exit paper trading' : 'Disconnect'}</button>
          <button type="button" className="trade-icon" onClick={onToggle} aria-label={collapsed ? 'Show account panel' : 'Hide account panel'}>
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
        </span>
      </header>
      {settingsOpen && paper && account?.settings && <PaperSettingsForm settings={account.settings} onDone={() => setSettingsOpen(false)} />}
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
            <tbody>{account.positions.map((position) => <PositionRow key={`${position.exchange}-${position.symbol}-${position.side}`} mode={mode} position={position} onSymbol={onSymbol} />)}</tbody>
          </table> : <p className="trade-empty">No open positions.</p>)}
          {tab === 'orders' && (account?.orders.length ? <table className="trade-table">
            <thead><tr><th>Symbol</th><th>Side</th><th>Type</th><th>Price</th><th>Trigger</th><th>Qty</th><th>Filled</th><th>TP / SL</th><th>Status</th><th>Placed</th><th /></tr></thead>
            <tbody>{account.orders.map((order) => <tr key={order.orderId}>
              <td><button type="button" className="trade-link" onClick={() => onSymbol?.(order.exchange ?? 'bybit', order.symbol)}><Venue exchange={order.exchange} />{order.symbol}</button></td>
              <td className={order.side === 'Buy' ? 'is-up' : 'is-down'}>{order.side}{order.reduceOnly ? ' · RO' : ''}</td>
              <td>{order.stopOrderType ? `${order.stopOrderType} ` : ''}{order.orderType}</td><td>{order.price ?? 'Market'}</td><td>{order.triggerPrice ?? '—'}</td>
              <td>{order.qty}</td><td>{order.filled}</td><td>{order.takeProfit ?? '—'} / {order.stopLoss ?? '—'}</td><td>{order.status}</td><td>{time(order.createdTime)}</td>
              <td><button type="button" className="trade-close" onClick={() => cancelOrder.mutate({ exchange: order.exchange, symbol: order.symbol, orderId: order.orderId },
                { onError: (e) => setActionError(e.message) })}>Cancel</button></td>
            </tr>)}</tbody>
          </table> : <p className="trade-empty">No open orders.</p>)}
          {tab === 'history' && (history.data?.orders.length ? <table className="trade-table">
            <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Type</th><th>Price</th><th>Qty</th><th>Filled</th><th>Status</th></tr></thead>
            <tbody>{history.data.orders.map((order) => <tr key={order.orderId}>
              <td>{time(order.updatedTime ?? order.createdTime)}</td><td><Venue exchange={order.exchange} />{order.symbol}</td>
              <td className={order.side === 'Buy' ? 'is-up' : 'is-down'}>{order.side}{order.reduceOnly ? ' · RO' : ''}</td>
              <td>{order.stopOrderType ? `${order.stopOrderType} ` : ''}{order.orderType}</td><td>{order.price ?? '—'}</td><td>{order.qty}</td><td>{order.filled}</td><td>{order.status}</td>
            </tr>)}</tbody>
          </table> : <p className="trade-empty">{history.isLoading ? 'Loading…' : history.error ? (history.error as Error).message : 'No orders yet.'}</p>)}
        </div>
      </>}
    </section>
  );
}
