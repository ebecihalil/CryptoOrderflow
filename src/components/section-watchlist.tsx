import type { ReactNode } from 'react';
import { Lock, Plus, Star, X } from 'lucide-react';
import type { CoinMemory } from '@/hooks/use-coin-memory';
import { requestSignIn } from '@/hooks/use-auth';
import { normalizeCoin } from '@/lib/coin-memory';
import '@/styles/chart-watchlist.css';
import '@/styles/section-watchlist.css';

export type WatchMetric = { value: string; detail?: string; tone?: 'positive' | 'negative' | 'neutral' } | null;

type Props = {
  memory: CoinMemory;
  /** Section shown in the eyebrow, e.g. "Global LSAR". */
  section: string;
  /** The coin currently searched/selected on the page (for the Add button). */
  currentCoin?: string | null;
  onSelect: (coin: string) => void;
  /** Live value for a coin in this section; null when not available. */
  metric: (coin: string) => WatchMetric;
  limit?: number;
};

/**
 * TradingView-style personal watchlist side panel, same look as the Super
 * Charts coin watchlist. Saved to the visitor's account (shared by every
 * section); signed-out visitors are invited to sign up.
 */
export function SectionWatchlist({ memory, section, currentCoin, onSelect, metric, limit = 50 }: Props) {
  const { watchlist, signedIn } = memory;
  const coin = normalizeCoin(currentCoin ?? '');
  const watched = coin ? memory.isWatched(coin) : false;
  const atCapacity = watchlist.length >= limit && !watched;
  const addLabel = memory.authLoading ? 'Checking your account…'
    : !signedIn ? 'Sign up free to use your watchlist'
    : !coin ? 'Search or select a coin to add'
    : watched ? `Remove ${coin} from watchlist`
    : atCapacity ? `Watchlist full · ${limit} coin limit`
    : `Add ${coin} to watchlist`;

  let body: ReactNode;
  if (memory.authLoading) {
    body = <div className="chart-watchlist-loading" role="status"><strong>Loading your watchlist</strong>Checking your account.</div>;
  } else if (!signedIn) {
    body = (
      <div className="chart-watchlist-empty section-watchlist-locked">
        <strong><Lock size={13} aria-hidden="true" /> Your personal watchlist</strong>
        Create a free account to save coins and see them here in every section, on any device.
      </div>
    );
  } else if (!watchlist.length) {
    body = (
      <div className="chart-watchlist-empty">
        <strong>No coins on your watchlist</strong>
        Search a coin and press Add, or click ☆ next to any coin in the table.
      </div>
    );
  } else {
    body = (
      <ul className="chart-watchlist-list" aria-label="Your watchlist">
        {watchlist.map((item) => {
          const active = item === coin;
          const value = metric(item);
          return (
            <li className={`chart-watchlist-item${active ? ' is-active' : ''}`} key={item}>
              <button type="button" className="chart-watchlist-select" aria-current={active ? 'true' : undefined}
                aria-label={`Show ${item}`} onClick={() => onSelect(item)} data-testid={`watchlist-row-${item}`}>
                <span className="chart-watchlist-asset-line">
                  <span className="chart-watchlist-asset">{item}</span>
                  <span className={`section-watchlist-value ${value?.tone ?? 'neutral'}`}>{value?.value ?? '—'}</span>
                </span>
                <span className="chart-watchlist-contract">{value?.detail ?? 'No reading in this section yet'}</span>
              </button>
              <button type="button" className="chart-watchlist-remove" aria-label={`Remove ${item} from watchlist`}
                title={`Remove ${item}`} onClick={() => void memory.toggle(item)}>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <aside className="chart-watchlist section-watchlist" aria-labelledby="section-watchlist-title" data-testid="section-watchlist">
      <header className="chart-watchlist-header">
        <div>
          <div className="chart-watchlist-eyebrow">My watchlist · {section}</div>
          <h2 className="chart-watchlist-heading" id="section-watchlist-title">Coin watchlist</h2>
        </div>
        <span className="chart-watchlist-count" aria-label={`${watchlist.length} of ${limit} coins`}>
          {signedIn ? `${watchlist.length}/${limit}` : <Lock size={12} aria-hidden="true" />}
        </span>
      </header>
      <p className="chart-watchlist-intro">
        {signedIn ? 'Saved to your account. The same list appears in every section with that section’s live values.'
          : 'Private to your account once you sign up. Free, no card needed.'}
      </p>
      <button className="chart-watchlist-add" type="button" data-testid="button-watchlist-add"
        disabled={memory.authLoading || (signedIn && (!coin || atCapacity))} aria-label={addLabel}
        onClick={() => { if (!signedIn) requestSignIn('watchlist'); else if (coin) void memory.toggle(coin); }}>
        <span>{addLabel}</span>
        {!signedIn ? <Star size={14} aria-hidden="true" /> : watched ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
      </button>
      {body}
      <footer className="chart-watchlist-footer">
        Click a coin to jump to it. Values refresh with this page. Recent coins stay in this browser; the watchlist follows your account.
      </footer>
    </aside>
  );
}
