import { Clock3, Lock, Star, X } from 'lucide-react';
import type { CoinMemory } from '@/hooks/use-coin-memory';
import { requestSignIn } from '@/hooks/use-auth';
import { normalizeCoin } from '@/lib/coin-memory';
import '@/styles/coin-shortcuts.css';

type Props = {
  memory: CoinMemory;
  /** Called with a coin when a chip is clicked. */
  onPick: (coin: string) => void;
  /** Currently selected/searched coin, highlighted in the chips. */
  active?: string;
  /** Table pages: show only watchlisted coins. */
  watchOnly?: boolean;
  onWatchOnlyChange?: (value: boolean) => void;
  /** Hide the personal watchlist (e.g. Super Charts has its own). */
  showWatchlist?: boolean;
};

/** Recent coins (this section) and the personal watchlist (all sections). */
export function CoinShortcuts({ memory, onPick, active = '', watchOnly, onWatchOnlyChange, showWatchlist = true }: Props) {
  const current = normalizeCoin(active);
  const { recent, signedIn } = memory;
  const watchlist = showWatchlist ? memory.watchlist : [];
  if (!showWatchlist && !recent.length) return null;
  return (
    <div className="coin-shortcuts" aria-label="Your coins">
      {showWatchlist && onWatchOnlyChange && (
        <button type="button" className={`coin-watch-only${watchOnly ? ' active' : ''}`} aria-pressed={!!watchOnly}
          onClick={() => (signedIn ? onWatchOnlyChange(!watchOnly) : requestSignIn('watchlist'))}
          disabled={signedIn && !watchlist.length && !watchOnly}
          title={!signedIn ? 'Sign up for a free account to use your watchlist'
            : watchlist.length ? 'Show only coins on your watchlist' : 'Star coins to build your watchlist'} data-testid="button-watch-only">
          <Star size={12} aria-hidden="true" fill={watchOnly ? 'currentColor' : 'none'} />
          Watchlist only{watchlist.length ? ` (${watchlist.length})` : ''}
          {!signedIn && <Lock size={11} aria-hidden="true" />}
        </button>
      )}
      {showWatchlist && !signedIn && !onWatchOnlyChange && (
        <button type="button" className="coin-watch-only" onClick={() => requestSignIn('watchlist')} data-testid="button-watch-locked"
          title="Sign up for a free account to use your watchlist">
          <Star size={12} aria-hidden="true" /> Watchlist <Lock size={11} aria-hidden="true" />
        </button>
      )}
      {watchlist.length > 0 && (
        <div className="coin-chip-group" role="group" aria-label="Your watchlist">
          <span className="coin-chip-label"><Star size={11} aria-hidden="true" fill="currentColor" />Watchlist</span>
          {watchlist.map((coin) => (
            <button key={`w-${coin}`} type="button" className={`coin-chip watched${coin === current ? ' active' : ''}`}
              onClick={() => onPick(coin)} data-testid={`chip-watch-${coin}`}>{coin}</button>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="coin-chip-group" role="group" aria-label="Recently viewed coins">
          <span className="coin-chip-label"><Clock3 size={11} aria-hidden="true" />Recent</span>
          {recent.map((coin) => (
            <button key={`r-${coin}`} type="button" className={`coin-chip${coin === current ? ' active' : ''}`}
              onClick={() => onPick(coin)} data-testid={`chip-recent-${coin}`}>{coin}</button>
          ))}
          <button type="button" className="coin-chip-clear" onClick={memory.clearRecent} aria-label="Clear recent coins"
            title="Clear recent coins"><X size={11} aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}

/** Star toggle for a coin row/heading. */
export function WatchStar({ memory, coin, size = 14 }: { memory: CoinMemory; coin: string; size?: number }) {
  const watched = memory.isWatched(coin);
  return (
    <button type="button" className={`coin-watch-star${watched ? ' watched' : ''}`} aria-pressed={watched}
      aria-label={`${watched ? 'Remove' : 'Add'} ${coin} ${watched ? 'from' : 'to'} your watchlist`}
      title={!memory.signedIn ? 'Sign up for a free account to use your watchlist' : watched ? 'On your watchlist' : 'Add to your watchlist'}
      onClick={(event) => { event.stopPropagation(); void memory.toggle(coin); }} data-testid={`button-watch-${normalizeCoin(coin)}`}>
      <Star size={size} aria-hidden="true" fill={watched ? 'currentColor' : 'none'} />
    </button>
  );
}
