import { useCallback, useEffect, useState } from 'react';
import {
  RECENT_LIMIT, WATCHLIST_KEY, WATCHLIST_LIMIT, normalizeCoin, pushRecent, readList, recentKey, toggleWatch, writeList,
  type CoinSection,
} from '@/lib/coin-memory';

const CHANGE_EVENT = 'cof-coin-memory';

/**
 * Recent coins for one section + the visitor's shared watchlist.
 * Updates propagate to other components on the page and to other tabs.
 */
export function useCoinMemory(section: CoinSection) {
  const key = recentKey(section);
  const [recent, setRecent] = useState<string[]>(() => readList(key, RECENT_LIMIT));
  const [watchlist, setWatchlist] = useState<string[]>(() => readList(WATCHLIST_KEY, WATCHLIST_LIMIT));

  useEffect(() => {
    const reload = () => {
      setRecent(readList(key, RECENT_LIMIT));
      setWatchlist(readList(WATCHLIST_KEY, WATCHLIST_LIMIT));
    };
    reload();
    window.addEventListener('storage', reload); // other tabs
    window.addEventListener(CHANGE_EVENT, reload); // other components in this tab
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener(CHANGE_EVENT, reload);
    };
  }, [key]);

  const notify = () => { try { window.dispatchEvent(new Event(CHANGE_EVENT)); } catch { /* ignore */ } };

  const remember = useCallback((coin: string) => {
    if (!normalizeCoin(coin)) return;
    setRecent((current) => {
      const next = pushRecent(current, coin);
      if (next.join() === current.join()) return current;
      writeList(key, next);
      queueMicrotask(notify);
      return next;
    });
  }, [key]);

  const toggle = useCallback((coin: string) => {
    setWatchlist((current) => {
      const next = toggleWatch(current, coin);
      writeList(WATCHLIST_KEY, next);
      queueMicrotask(notify);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
    writeList(key, []);
    queueMicrotask(notify);
  }, [key]);

  const isWatched = useCallback((coin: string) => watchlist.includes(normalizeCoin(coin)), [watchlist]);

  return { recent, watchlist, remember, toggle, isWatched, clearRecent };
}

export type CoinMemory = ReturnType<typeof useCoinMemory>;
