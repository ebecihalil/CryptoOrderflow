// "Connect" window opened by the Trade button: Paper Trading (instant, simulated money)
// and, for the owner only, the real Bybit account.
import { FileText, X } from 'lucide-react';
import { Link } from 'wouter';
import '@/styles/trading.css';
import { ExchangeLogo } from '@/components/exchange-logo';
import { tradeStore } from '@/lib/trade-store';

export function TradeConnect({ signedIn, canReal, testnet }: { signedIn: boolean; canReal: boolean; testnet: boolean }) {
  const close = () => tradeStore.setConnectOpen(false);
  return (
    <div className="trade-connect-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="trade-connect" role="dialog" aria-modal="true" aria-label="Connect a trading account" data-testid="trade-connect">
        <header><h2>Trade</h2><button type="button" className="trade-icon" onClick={close} aria-label="Close"><X size={16} /></button></header>
        {!signedIn ? <div className="trade-connect-signin">
          <p>Sign in to start paper trading: practise with simulated money on live prices, from any chart.</p>
          <Link href="/signin" className="trade-save" onClick={close}>Sign in</Link>
        </div> : <div className="trade-connect-grid">
          <button type="button" className="trade-connect-card" onClick={() => tradeStore.connect('paper')} data-testid="connect-paper">
            <span className="trade-connect-logo is-paper"><FileText size={30} aria-hidden="true" /></span>
            <b>Paper Trading</b>
            <small>Simulated money · live prices · any exchange</small>
            <span className="trade-connect-cta">Connect</span>
          </button>
          {canReal && <button type="button" className="trade-connect-card" onClick={() => tradeStore.connect('real')} data-testid="connect-bybit">
            <span className="trade-connect-logo"><ExchangeLogo exchange="bybit" /></span>
            <b>Bybit</b>
            <small>{testnet ? 'Your Bybit testnet account' : 'Your real Bybit account · real money'}</small>
            <span className="trade-connect-cta is-real">Connect</span>
          </button>}
        </div>}
      </div>
    </div>
  );
}
