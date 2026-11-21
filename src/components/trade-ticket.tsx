// TradingView-style order ticket: paper trading (any exchange on the chart) or the owner's
// real Bybit account. The order being drafted lives in the trade store, so the chart's
// order / TP / SL lines and this ticket edit the same values.
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import '@/styles/trading.css';
import { useTradingActions, useTradingMarket, type OrderInput, type TradingAccount, type TradingMode } from '@/hooks/use-trading';
import { tradeStore, useTradeStore, type OrderType } from '@/lib/trade-store';
import { ExchangeLogo } from '@/components/exchange-logo';

const TYPES: Array<{ id: OrderType; label: string }> = [
  { id: 'market', label: 'Market' }, { id: 'limit', label: 'Limit' }, { id: 'stop', label: 'Stop' }, { id: 'stopLimit', label: 'Stop Limit' },
];
const num = (value: string | number | null | undefined) => { const n = Number(value); return value !== '' && value !== null && value !== undefined && Number.isFinite(n) ? n : null; };
export const stepDecimals = (step: string) => (step.includes('.') ? step.split('.')[1].replace(/0+$/, '').length : 0);
const usd = (value: number | null) => value === null ? '—' : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`;
const readPref = (key: string, fallback: boolean) => { try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; } };
const writePref = (key: string, value: boolean) => { try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* private mode */ } };

/** Price the order would execute around: market = bid/ask, stop = trigger, limit = limit price. */
export function orderPrice(type: OrderType, side: 'Buy' | 'Sell', price: string, trigger: string, quote?: { bid: string | null; ask: string | null; last: string | null }) {
  if (type === 'market') return num(side === 'Buy' ? quote?.ask : quote?.bid) ?? num(quote?.last);
  if (type === 'stop') return num(trigger);
  return num(price);
}

export function TradeTicket({ mode, testnet, account, onClose }: {
  mode: TradingMode; testnet: boolean; account: TradingAccount | undefined; onClose: () => void;
}) {
  const target = useTradeStore((s) => s.target);
  const draft = useTradeStore((s) => s.draft);
  const market = useTradingMarket(mode, target, true);
  const { placeOrder } = useTradingActions(mode);
  const info = market.data;
  const { side, type, price, trigger, qty, unit, tpOn, tp, slOn, sl } = draft;
  const set = tradeStore.setDraft;
  const [leverage, setLeverage] = useState('');
  const [tif, setTif] = useState<NonNullable<OrderInput['timeInForce']>>('GTC');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [confirm, setConfirmPref] = useState(() => readPref('trade-confirm', true));
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => { setMessage(null); setLeverage(''); }, [target?.exchange, target?.symbol, mode]);
  useEffect(() => { if (info?.leverage && !leverage) setLeverage(String(info.leverage)); }, [info?.leverage, leverage]);
  // Limit / stop prices start at the current price.
  useEffect(() => {
    if (!info) return;
    if (!price) { const ref = side === 'Buy' ? info.bid ?? info.last : info.ask ?? info.last; if (ref) set({ price: ref }); }
    if (!trigger && info.last) set({ trigger: info.last });
  }, [info, price, trigger, side, set]);

  const tick = info?.tickSize ?? '0.01';
  const refPrice = orderPrice(type, side, price, trigger, info);
  const lev = num(leverage) ?? 1;
  // Amount typed in coins or in USDT; orders always go out in coins.
  const coins = unit === 'usdt' ? (num(qty) !== null && refPrice ? num(qty)! / refPrice : null) : num(qty);
  const value = coins !== null && refPrice !== null ? coins * refPrice : null;
  const available = num(account?.balance.available);
  const maxValue = available !== null ? available * lev : null;
  const setPercent = (pct: number) => {
    if (!maxValue || !refPrice || !info) return;
    const v = maxValue * pct / 100;
    if (unit === 'usdt') set({ qty: v.toFixed(2) });
    else { const step = Number(info.qtyStep); set({ qty: (Math.floor(v / refPrice / step) * step).toFixed(stepDecimals(info.qtyStep)) }); }
  };
  const percent = maxValue && value ? Math.min(100, Math.round(value / maxValue * 100)) : 0;
  const pnlAt = (target: string) => {
    const t = num(target);
    if (t === null || refPrice === null || coins === null) return null;
    return (side === 'Buy' ? t - refPrice : refPrice - t) * coins;
  };
  const coinText = coins !== null && info ? Number((Math.floor(coins / Number(info.qtyStep)) * Number(info.qtyStep)).toFixed(stepDecimals(info.qtyStep))) : 0;
  const label = useMemo(() => {
    const what = `${coinText.toLocaleString()} ${target?.symbol ?? ''}`;
    if (type === 'market') return `${what} MARKET`;
    if (type === 'limit') return `${what} @ ${price || '—'} LIMIT`;
    if (type === 'stop') return `${what} STOP @ ${trigger || '—'}`;
    return `${what} @ ${price || '—'} STOP ${trigger || '—'}`;
  }, [coinText, target?.symbol, type, price, trigger]);

  const submit = () => {
    if (!target || !coins) { setMessage({ kind: 'error', text: 'Enter an amount.' }); return; }
    const input: OrderInput = { exchange: target.exchange, asset: target.asset, symbol: target.symbol, side, type, qty: coins,
      leverage: num(leverage) ?? undefined, reduceOnly: reduceOnly || undefined };
    if (type === 'limit' || type === 'stopLimit') { input.price = num(price) ?? undefined; input.timeInForce = tif; }
    if (type === 'stop' || type === 'stopLimit') input.triggerPrice = num(trigger) ?? undefined;
    if (tpOn && num(tp)) input.takeProfit = num(tp)!;
    if (slOn && num(sl)) input.stopLoss = num(sl)!;
    const tag = mode === 'paper' ? '[PAPER] ' : testnet ? '[TESTNET] ' : '[REAL MONEY] ';
    if (confirm && !window.confirm(`${tag}${side} ${label}${input.takeProfit ? `\nTP ${input.takeProfit}` : ''}${input.stopLoss ? `\nSL ${input.stopLoss}` : ''}\n\n${mode === 'paper' ? 'Place this paper order?' : 'Send this order to Bybit?'}`)) return;
    setMessage(null);
    placeOrder.mutate(input, {
      onSuccess: () => { setMessage({ kind: 'ok', text: type === 'market' ? 'Order filled at market.' : 'Order placed.' }); set({ tpOn: false, slOn: false, tp: '', sl: '' }); },
      onError: (error) => setMessage({ kind: 'error', text: error.message }),
    });
  };

  return (
    <aside className="trade-ticket" aria-label="Order ticket" data-testid="trade-ticket">
      <header className="trade-ticket-head">
        {mode === 'paper' ? <span className="trade-paper" title="Simulated money, live prices">PAPER</span>
          : <><ExchangeLogo exchange="bybit" />{testnet ? <span className="trade-testnet" title="Bybit testnet: fake money">TESTNET</span>
            : <span className="trade-real" title="Real money on your Bybit account">REAL</span>}</>}
        <strong>{target?.symbol ?? '—'}</strong>
        {mode === 'paper' && target && <small className="trade-venue">{target.label}</small>}
        <button type="button" className="trade-icon" onClick={onClose} aria-label="Close order ticket"><X size={15} /></button>
      </header>
      {market.error && <p className="trade-msg is-error">{(market.error as Error).message}</p>}
      <div className="trade-sides" role="radiogroup" aria-label="Side">
        <button type="button" className={`trade-side is-sell${side === 'Sell' ? ' is-on' : ''}`} onClick={() => tradeStore.setSide('Sell', refPrice)} aria-pressed={side === 'Sell'}>
          <small>Sell</small><b>{info?.bid ?? '—'}</b></button>
        <button type="button" className={`trade-side is-buy${side === 'Buy' ? ' is-on' : ''}`} onClick={() => tradeStore.setSide('Buy', refPrice)} aria-pressed={side === 'Buy'}>
          <small>Buy</small><b>{info?.ask ?? '—'}</b></button>
        {info?.bid && info?.ask && <span className="trade-spread">{Math.max(0, Number(info.ask) - Number(info.bid)).toFixed(stepDecimals(tick))}</span>}
      </div>
      <div className="trade-tabs" role="tablist">
        {TYPES.map((item) => <button key={item.id} type="button" role="tab" aria-selected={type === item.id}
          className={type === item.id ? 'is-on' : ''} onClick={() => set({ type: item.id })}>{item.label}</button>)}
      </div>
      <label className="trade-field"><span>Leverage</span>
        <div className="trade-input"><input type="number" min="1" max={info?.maxLeverage ?? 100} step="1" value={leverage}
          onChange={(event) => setLeverage(event.target.value)} aria-label="Leverage" /><em>x{info ? ` · max ${info.maxLeverage}x` : ''}</em></div></label>
      {(type === 'stop' || type === 'stopLimit') && <label className="trade-field"><span>Stop price</span>
        <div className="trade-input"><input type="number" step={tick} value={trigger} onChange={(event) => set({ trigger: event.target.value })} aria-label="Stop price" />
          <button type="button" onClick={() => info?.last && set({ trigger: info.last })}>Last</button></div></label>}
      {(type === 'limit' || type === 'stopLimit') && <label className="trade-field"><span>Price</span>
        <div className="trade-input"><input type="number" step={tick} value={price} onChange={(event) => set({ price: event.target.value })} aria-label="Limit price" />
          <button type="button" onClick={() => { const v = side === 'Buy' ? info?.bid : info?.ask; if (v) set({ price: v }); }}>{side === 'Buy' ? 'Bid' : 'Ask'}</button></div></label>}
      <label className="trade-field"><span className="trade-field-head">Amount
        <select value={unit} onChange={(event) => { const next = event.target.value as 'coin' | 'usdt';
          set({ unit: next, qty: next === 'usdt' ? (value !== null ? value.toFixed(2) : '') : (coins !== null ? String(coinText) : '') }); }}
          aria-label="Amount unit"><option value="coin">{info?.base ?? 'Coin'}</option><option value="usdt">USDT</option></select></span>
        <div className="trade-input"><input type="number" min="0" step={unit === 'usdt' ? '1' : info?.qtyStep ?? '1'} value={qty} onChange={(event) => set({ qty: event.target.value })} aria-label="Amount" />
          <em>{unit === 'usdt' ? `${coinText.toLocaleString()} ${info?.base ?? ''}` : usd(value)}</em></div></label>
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
      <div className="trade-section">Exits <small>· drag TP / SL on the chart</small></div>
      <div className="trade-exit">
        <label className="trade-switch"><input type="checkbox" checked={tpOn} onChange={(event) => set({ tpOn: event.target.checked, ...(event.target.checked && !tp && refPrice ? { tp: (refPrice * (side === 'Buy' ? 1.03 : 0.97)).toFixed(stepDecimals(tick)) } : {}) })} /> Take profit</label>
        <div className="trade-input"><input type="number" step={tick} value={tp} disabled={!tpOn} onChange={(event) => set({ tp: event.target.value })} aria-label="Take profit price" />
          <em className={(pnlAt(tp) ?? 0) >= 0 ? 'is-up' : 'is-down'}>{tpOn && pnlAt(tp) !== null ? usd(pnlAt(tp)) : ''}</em></div>
      </div>
      <div className="trade-exit">
        <label className="trade-switch"><input type="checkbox" checked={slOn} onChange={(event) => set({ slOn: event.target.checked, ...(event.target.checked && !sl && refPrice ? { sl: (refPrice * (side === 'Buy' ? 0.98 : 1.02)).toFixed(stepDecimals(tick)) } : {}) })} /> Stop loss</label>
        <div className="trade-input"><input type="number" step={tick} value={sl} disabled={!slOn} onChange={(event) => set({ sl: event.target.value })} aria-label="Stop loss price" />
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
