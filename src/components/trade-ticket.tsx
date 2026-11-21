// TradingView-style order ticket for the owner's Bybit account (USDT perpetuals, one-way mode).
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import '@/styles/trading.css';
import { useTradingActions, useTradingMarket, type OrderInput, type TradingAccount, type TradingMode } from '@/hooks/use-trading';

type OrderType = OrderInput['type'];
const TYPES: Array<{ id: OrderType; label: string }> = [
  { id: 'market', label: 'Market' }, { id: 'limit', label: 'Limit' }, { id: 'stop', label: 'Stop' }, { id: 'stopLimit', label: 'Stop Limit' },
];
const num = (value: string | number | null | undefined) => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const decimals = (step: string) => (step.includes('.') ? step.split('.')[1].replace(/0+$/, '').length : 0);
const usd = (value: number | null) => value === null ? '—' : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`;
const readPref = (key: string, fallback: boolean) => { try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; } };
const writePref = (key: string, value: boolean) => { try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* private mode */ } };

export function TradeTicket({ mode, canReal, onMode, symbol, account, testnet, onClose }: {
  mode: TradingMode; canReal: boolean; onMode: (mode: TradingMode) => void;
  symbol: string | null; account: TradingAccount | undefined; testnet: boolean; onClose: () => void;
}) {
  const market = useTradingMarket(mode, symbol, true);
  const { placeOrder } = useTradingActions(mode);
  const info = market.data;
  const [side, setSide] = useState<'Buy' | 'Sell'>('Buy');
  const [type, setType] = useState<OrderType>('limit');
  const [price, setPrice] = useState('');
  const [trigger, setTrigger] = useState('');
  const [qty, setQty] = useState('');
  const [leverage, setLeverage] = useState('');
  const [tpOn, setTpOn] = useState(false); const [tp, setTp] = useState('');
  const [slOn, setSlOn] = useState(false); const [sl, setSl] = useState('');
  const [tif, setTif] = useState<NonNullable<OrderInput['timeInForce']>>('GTC');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [confirm, setConfirmPref] = useState(() => readPref('trade-confirm', true));
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // New contract: start from its current price and leverage.
  useEffect(() => { setPrice(''); setTrigger(''); setQty(''); setTp(''); setSl(''); setMessage(null); setLeverage(''); }, [symbol]);
  useEffect(() => { if (info?.leverage && !leverage) setLeverage(String(info.leverage)); }, [info?.leverage, leverage]);
  useEffect(() => {
    if (!info || price) return;
    const ref = side === 'Buy' ? info.ask ?? info.last : info.bid ?? info.last;
    if (ref) setPrice(ref);
  }, [info, price, side]);

  const tick = info?.tickSize ?? '0.01';
  const refPrice = type === 'market' ? num(side === 'Buy' ? info?.ask : info?.bid) ?? num(info?.last)
    : type === 'stop' ? num(trigger) : num(price);
  const amount = num(qty), lev = num(leverage) ?? 1;
  const value = amount !== null && refPrice !== null ? amount * refPrice : null;
  const available = num(account?.balance.available);
  const maxQty = available !== null && refPrice ? available * lev / refPrice : null;
  const setPercent = (pct: number) => {
    if (!maxQty || !info) return;
    const step = Number(info.qtyStep);
    setQty((Math.floor(maxQty * pct / 100 / step) * step).toFixed(decimals(info.qtyStep)));
  };
  const percent = maxQty && amount ? Math.min(100, Math.round(amount / maxQty * 100)) : 0;
  const pnlAt = (target: string) => {
    const t = num(target);
    if (t === null || refPrice === null || amount === null) return null;
    return (side === 'Buy' ? t - refPrice : refPrice - t) * amount;
  };
  const label = useMemo(() => {
    const what = `${side} ${amount ?? 0} ${symbol ?? ''}`;
    if (type === 'market') return `${what} MARKET`;
    if (type === 'limit') return `${what} @ ${price || '—'} LIMIT`;
    if (type === 'stop') return `${what} STOP @ ${trigger || '—'}`;
    return `${what} @ ${price || '—'} STOP ${trigger || '—'}`;
  }, [side, amount, symbol, type, price, trigger]);

  const submit = () => {
    if (!symbol || !amount) { setMessage({ kind: 'error', text: 'Enter an amount.' }); return; }
    const input: OrderInput = { symbol, side, type, qty: amount, leverage: num(leverage) ?? undefined, reduceOnly: reduceOnly || undefined };
    if (type === 'limit' || type === 'stopLimit') { input.price = num(price) ?? undefined; input.timeInForce = tif; }
    if (type === 'stop' || type === 'stopLimit') input.triggerPrice = num(trigger) ?? undefined;
    if (tpOn && num(tp)) input.takeProfit = num(tp)!;
    if (slOn && num(sl)) input.stopLoss = num(sl)!;
    if (confirm && !window.confirm(`${mode === 'paper' ? '[PAPER] ' : testnet ? '[TESTNET] ' : '[REAL MONEY] '}${label}${input.takeProfit ? `\nTP ${input.takeProfit}` : ''}${input.stopLoss ? `\nSL ${input.stopLoss}` : ''}\n\n${mode === 'paper' ? 'Place this paper order?' : 'Send this order to Bybit?'}`)) return;
    setMessage(null);
    placeOrder.mutate(input, {
      onSuccess: () => setMessage({ kind: 'ok', text: `Order sent${type === 'market' ? ' and filled at market' : ''}.` }),
      onError: (error) => setMessage({ kind: 'error', text: error.message }),
    });
  };

  return (
    <aside className="trade-ticket" aria-label="Order ticket" data-testid="trade-ticket">
      <header className="trade-ticket-head">
        <span className="trade-ticket-venue">BYBIT</span><strong>{symbol ?? '—'}</strong>
        {mode === 'paper' ? <span className="trade-paper" title="Simulated money, live Bybit prices">PAPER</span>
          : testnet ? <span className="trade-testnet" title="Bybit testnet: fake money">TESTNET</span>
          : <span className="trade-real" title="Real money on your Bybit account">REAL</span>}
        <button type="button" className="trade-icon" onClick={onClose} aria-label="Close order ticket"><X size={15} /></button>
      </header>
      {canReal && <div className="trade-mode" role="radiogroup" aria-label="Trading mode">
        <button type="button" className={mode === 'paper' ? 'is-on' : ''} aria-pressed={mode === 'paper'} onClick={() => onMode('paper')}>Paper</button>
        <button type="button" className={`is-real${mode === 'real' ? ' is-on' : ''}`} aria-pressed={mode === 'real'} onClick={() => onMode('real')}>Real{testnet ? ' (testnet)' : ''}</button>
      </div>}
      {market.error && <p className="trade-msg is-error">{(market.error as Error).message}</p>}
      <div className="trade-sides" role="radiogroup" aria-label="Side">
        <button type="button" className={`trade-side is-sell${side === 'Sell' ? ' is-on' : ''}`} onClick={() => setSide('Sell')} aria-pressed={side === 'Sell'}>
          <small>Sell</small><b>{info?.bid ?? '—'}</b></button>
        <button type="button" className={`trade-side is-buy${side === 'Buy' ? ' is-on' : ''}`} onClick={() => setSide('Buy')} aria-pressed={side === 'Buy'}>
          <small>Buy</small><b>{info?.ask ?? '—'}</b></button>
        {info?.bid && info?.ask && <span className="trade-spread">{(Number(info.ask) - Number(info.bid)).toFixed(decimals(tick))}</span>}
      </div>
      <div className="trade-tabs" role="tablist">
        {TYPES.map((item) => <button key={item.id} type="button" role="tab" aria-selected={type === item.id}
          className={type === item.id ? 'is-on' : ''} onClick={() => setType(item.id)}>{item.label}</button>)}
      </div>
      <label className="trade-field"><span>Leverage</span>
        <div className="trade-input"><input type="number" min="1" max={info?.maxLeverage ?? 100} step="1" value={leverage}
          onChange={(event) => setLeverage(event.target.value)} aria-label="Leverage" /><em>x{info ? ` · max ${info.maxLeverage}x` : ''}</em></div></label>
      {(type === 'stop' || type === 'stopLimit') && <label className="trade-field"><span>Stop price</span>
        <div className="trade-input"><input type="number" step={tick} value={trigger} onChange={(event) => setTrigger(event.target.value)} aria-label="Stop price" />
          <button type="button" onClick={() => info?.last && setTrigger(info.last)}>Last</button></div></label>}
      {(type === 'limit' || type === 'stopLimit') && <label className="trade-field"><span>Price</span>
        <div className="trade-input"><input type="number" step={tick} value={price} onChange={(event) => setPrice(event.target.value)} aria-label="Limit price" />
          <button type="button" onClick={() => { const v = side === 'Buy' ? info?.bid : info?.ask; if (v) setPrice(v); }}>{side === 'Buy' ? 'Bid' : 'Ask'}</button></div></label>}
      <label className="trade-field"><span>Amount ({info?.base ?? 'coin'})</span>
        <div className="trade-input"><input type="number" min="0" step={info?.qtyStep ?? '1'} value={qty} onChange={(event) => setQty(event.target.value)} aria-label="Amount" />
          <em>{usd(value)}</em></div></label>
      <div className="trade-percent">
        <input type="range" min="0" max="100" step="1" value={percent} onChange={(event) => setPercent(Number(event.target.value))} aria-label="Percent of available balance" />
        <span>{percent}%</span>
      </div>
      <div className="trade-quick">{[10, 25, 50, 75, 100].map((pct) => <button key={pct} type="button" onClick={() => setPercent(pct)}>{pct}%</button>)}</div>
      <dl className="trade-facts">
        <dt>Trade value</dt><dd>{usd(value)}</dd>
        <dt>Margin</dt><dd>{usd(value !== null ? value / lev : null)}</dd>
        <dt>Available</dt><dd>{usd(available)}</dd>
      </dl>
      <div className="trade-section">Exits</div>
      <div className="trade-exit">
        <label className="trade-switch"><input type="checkbox" checked={tpOn} onChange={(event) => setTpOn(event.target.checked)} /> Take profit</label>
        <div className="trade-input"><input type="number" step={tick} value={tp} disabled={!tpOn} onChange={(event) => setTp(event.target.value)} aria-label="Take profit price" />
          <em className={(pnlAt(tp) ?? 0) >= 0 ? 'is-up' : 'is-down'}>{tpOn && pnlAt(tp) !== null ? usd(pnlAt(tp)) : ''}</em></div>
      </div>
      <div className="trade-exit">
        <label className="trade-switch"><input type="checkbox" checked={slOn} onChange={(event) => setSlOn(event.target.checked)} /> Stop loss</label>
        <div className="trade-input"><input type="number" step={tick} value={sl} disabled={!slOn} onChange={(event) => setSl(event.target.value)} aria-label="Stop loss price" />
          <em className={(pnlAt(sl) ?? 0) >= 0 ? 'is-up' : 'is-down'}>{slOn && pnlAt(sl) !== null ? usd(pnlAt(sl)) : ''}</em></div>
      </div>
      <div className="trade-section">Extra settings</div>
      {(type === 'limit' || type === 'stopLimit') && <label className="trade-field"><span>Time in force</span>
        <select value={tif} onChange={(event) => setTif(event.target.value as typeof tif)}>
          <option value="GTC">Good-Till-Canceled</option><option value="IOC">Immediate-Or-Cancel</option>
          <option value="FOK">Fill-Or-Kill</option><option value="PostOnly">Post-Only</option></select></label>}
      <label className="trade-switch"><input type="checkbox" checked={reduceOnly} onChange={(event) => setReduceOnly(event.target.checked)} /> Reduce-only</label>
      <label className="trade-switch"><input type="checkbox" checked={confirm} onChange={(event) => { setConfirmPref(event.target.checked); writePref('trade-confirm', event.target.checked); }} /> Confirm before sending</label>
      {message && <p className={`trade-msg is-${message.kind}`} role="status">{message.text}</p>}
      <button type="button" className={`trade-submit is-${side === 'Buy' ? 'buy' : 'sell'}`} onClick={submit} disabled={placeOrder.isPending || !info}
        data-testid="trade-submit">
        <b>{placeOrder.isPending ? 'Sending…' : side}</b><small>{label}</small>
      </button>
    </aside>
  );
}
