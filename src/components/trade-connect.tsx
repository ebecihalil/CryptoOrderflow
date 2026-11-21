// "Connect" window opened by the Trade button. Everyone signed in: Paper Trading (instant,
// simulated money). Admins only: real exchange accounts (Bybit; Binance coming).
import { useState } from 'react';
import { FileText, X } from 'lucide-react';
import { Link } from 'wouter';
import '@/styles/trading.css';
import { ExchangeLogo } from '@/components/exchange-logo';
import { tradeStore } from '@/lib/trade-store';
import type { TradingStatus } from '@/hooks/use-trading';

export function TradeConnect({ signedIn, status }: { signedIn: boolean; status: TradingStatus | undefined }) {
  const close = () => tradeStore.setConnectOpen(false);
  const [setup, setSetup] = useState(false);
  const admin = !!status?.admin;
  return (
    <div className="trade-connect-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="trade-connect" role="dialog" aria-modal="true" aria-label="Connect a trading account" data-testid="trade-connect">
        <header><h2>Trade</h2><button type="button" className="trade-icon" onClick={close} aria-label="Close"><X size={16} /></button></header>
        {!signedIn ? <div className="trade-connect-signin">
          <p>Sign in to start paper trading: practise with simulated money on live prices, from any chart.</p>
          <Link href="/signin" className="trade-save" onClick={close}>Sign in</Link>
        </div> : <>
          <div className="trade-connect-grid">
            <button type="button" className="trade-connect-card" onClick={() => tradeStore.connect('paper')} data-testid="connect-paper">
              <span className="trade-connect-logo is-paper"><FileText size={30} aria-hidden="true" /></span>
              <b>Paper Trading</b>
              <small>Simulated money · live prices</small>
              <span className="trade-connect-cta">Connect</span>
            </button>
            {admin && <button type="button" className="trade-connect-card" data-testid="connect-bybit"
              onClick={() => status?.bybit === 'ready' ? tradeStore.connect('real') : setSetup(true)}>
              <span className="trade-connect-logo"><ExchangeLogo exchange="bybit" /></span>
              <b>Bybit</b>
              <small>{status?.bybit === 'ready' ? status.testnet ? 'Testnet account' : 'Real money' : 'Not set up yet'}</small>
              <span className="trade-connect-cta is-real">Connect</span>
            </button>}
            {admin && <button type="button" className="trade-connect-card is-soon" disabled data-testid="connect-binance">
              <span className="trade-connect-logo"><ExchangeLogo exchange="binance" /></span>
              <b>Binance</b>
              <small>Coming soon</small>
              <span className="trade-connect-cta is-soon">Soon</span>
            </button>}
          </div>
          {admin && <p className="trade-connect-note">Exchange accounts are visible to admins only. Other users see Paper Trading.</p>}
          {setup && <div className="trade-connect-setup" data-testid="bybit-setup">
            <b>Bybit is not connected yet</b>
            <p>Create a Bybit API key (permissions: Contracts → Orders + Positions only, no withdraw; IP restricted to the server),
              then add it to the server's settings file as described in the server guide. After a restart, Connect opens your Bybit account here.</p>
          </div>}
        </>}
      </div>
    </div>
  );
}
