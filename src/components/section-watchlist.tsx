import { useMemo, useState, type ReactNode } from 'react';
import { Lock, Plus, Star, X } from 'lucide-react';
import type { CoinMemory } from '@/hooks/use-coin-memory';
import { requestSignIn } from '@/hooks/use-auth';
import { normalizeCoin } from '@/lib/coin-memory';
import { useI18n } from '@/lib/i18n';
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
  /** Coins available in this section, for search suggestions and typo checks. */
  coins?: string[];
};

/**
 * TradingView-style personal watchlist side panel, same look as the Super
 * Charts coin watchlist. Saved to the visitor's account (shared by every
 * section); signed-out visitors are invited to sign up.
 */
export function SectionWatchlist({ memory, section, currentCoin, onSelect, metric, limit = 50, coins }: Props) {
  const { watchlist, signedIn } = memory;
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const { t } = useI18n();
  const typed = normalizeCoin(query);
  const known = useMemo(() => [...new Set((coins ?? []).map(normalizeCoin).filter(Boolean))], [coins]);
  const suggestions = useMemo(() => {
    if (!typed) return [];
    const starts = known.filter((item) => item.startsWith(typed));
    const contains = known.filter((item) => !item.startsWith(typed) && item.includes(typed));
    return [...starts.sort((a, b) => a.length - b.length || a.localeCompare(b)), ...contains].slice(0, 8);
  }, [typed, known]);
  const coin = normalizeCoin(currentCoin ?? '');
  const watched = coin ? memory.isWatched(coin) : false;

  let body: ReactNode;
  if (memory.authLoading) {
    body = <div className="chart-watchlist-loading" role="status"><strong>Loading your watchlist</strong>Checking your account.</div>;
  } else if (!signedIn) {
    body = (
      <div className="chart-watchlist-empty section-watchlist-locked">
        <strong><Lock size={13} aria-hidden="true" /> {t('Your personal watchlist')}</strong>
        {t('Create a free account to save coins and see them here in every section, on any device.')}
      </div>
    );
  } else if (!watchlist.length) {
    body = (
      <div className="chart-watchlist-empty">
        <strong>{t('No coins on your watchlist')}</strong>
        {t('Type a coin above and press +, or click ☆ next to any coin in the table.')}
      </div>
    );
  } else {
    body = (
      <ul className="chart-watchlist-list" aria-label="Your watchlist">
        {watchlist.map((item) => {
          const isCurrent = item === coin;
          const value = metric(item);
          return (
            <li className={`chart-watchlist-item${isCurrent ? ' is-active' : ''}`} key={item}>
              <button type="button" className="chart-watchlist-select" aria-current={isCurrent ? 'true' : undefined}
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
          <div className="chart-watchlist-eyebrow">{t('My watchlist')} · {section}</div>
          <h2 className="chart-watchlist-heading" id="section-watchlist-title">{t('Coin watchlist')}</h2>
        </div>
        <span className="chart-watchlist-count" aria-label={`${watchlist.length} of ${limit} coins`}>
          {signedIn ? `${watchlist.length}/${limit}` : <Lock size={12} aria-hidden="true" />}
        </span>
      </header>
      <p className="chart-watchlist-intro">
        {t(signedIn ? 'Saved to your account. The same list appears in every section with that section’s live values.'
          : 'Private to your account once you sign up. Free, no card needed.')}
      </p>
      {/* Type a coin and press + (or Enter). Empty box + adds the coin on screen. */}
      <form className="section-watchlist-search" role="search" onSubmit={(event) => {
        event.preventDefault();
        if (!signedIn) { requestSignIn('watchlist'); return; }
        const pick = suggestions[active] ?? typed;
        const target = pick || coin;
        if (!target) { setMessage('Type a coin, e.g. BTC.'); return; }
        if (known.length && !known.includes(target)) { setMessage(`${target} is not listed in ${section}.`); return; }
        if (memory.isWatched(target)) { setMessage(`${target} is already on your watchlist.`); setQuery(''); return; }
        if (watchlist.length >= limit) { setMessage(`Watchlist full · ${limit} coin limit.`); return; }
        void memory.toggle(target); setQuery(''); setActive(0); setMessage(`${target} added.`);
      }}>
        <input value={query} disabled={memory.authLoading} aria-label={`Search ${section} coins to add`}
          placeholder={!signedIn ? t('Sign up to add coins') : t('Type a coin, e.g. BTC')}
          onFocus={() => { if (!signedIn && !memory.authLoading) requestSignIn('watchlist'); }}
          onChange={(event) => { setQuery(event.target.value); setActive(0); setMessage(null); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1))); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            if (event.key === 'Escape') setQuery('');
          }}
          autoCapitalize="characters" spellCheck={false} maxLength={30} data-testid="input-watchlist-search" />
        <button type="submit" className="section-watchlist-plus" aria-label="Add to watchlist" title="Add to watchlist"
          disabled={memory.authLoading} data-testid="button-watchlist-add">
          {!signedIn ? <Star size={15} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
        </button>
        {signedIn && suggestions.length > 0 && (
          <ul className="section-watchlist-suggestions" role="listbox" aria-label="Matching coins">
            {suggestions.map((item, index) => (
              <li key={item} role="option" aria-selected={index === active}>
                <button type="button" className={index === active ? 'is-active' : ''}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (memory.isWatched(item)) { setMessage(`${item} is already on your watchlist.`); setQuery(''); return; }
                    void memory.toggle(item); setQuery(''); setMessage(`${item} added.`);
                  }}>
                  <span>{item}</span>{memory.isWatched(item) ? <small>On watchlist</small> : <Plus size={12} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
      {message && <p className="section-watchlist-message" role="status">{message}</p>}
      {signedIn && coin && watched && <button type="button" className="section-watchlist-remove-current" onClick={() => void memory.toggle(coin)}>
        Remove {coin} from watchlist</button>}
      {body}
      <footer className="chart-watchlist-footer">
        Click a coin to jump to it. Values refresh with this page. Recent coins stay in this browser; the watchlist follows your account.
      </footer>
    </aside>
  );
}
