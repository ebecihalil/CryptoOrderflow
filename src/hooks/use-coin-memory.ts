import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RECENT_LIMIT, WATCHLIST_KEY, WATCHLIST_LIMIT, normalizeCoin, pushRecent, readList, recentKey, writeList,
  type CoinSection,
} from '@/lib/coin-memory';
import { AUTH_KEY, SIGNED_OUT_EVENT, WATCHLIST_QUERY_KEY, fetchMe, requestSignIn, useAuth, watchlistApi } from '@/hooks/use-auth';

const CHANGE_EVENT = 'cof-coin-memory';
let migrating = false;
const EMPTY: string[] = [];

/**
 * Recent coins: free, per section, stored in this browser.
 * Watchlist: requires a (free) account; stored on the server per account.
 * Signed-out visitors see the controls; using them opens the sign-up prompt.
 */
export function useCoinMemory(section: CoinSection) {
  const key = recentKey(section);
  const client = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const [recent, setRecent] = useState<string[]>(() => readList(key, RECENT_LIMIT));
  // Sign-out clears this browser's recent coins (back to the defaults).
  useEffect(() => {
    const reset = () => setRecent([]);
    window.addEventListener(SIGNED_OUT_EVENT, reset);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, reset);
  }, []);

  const watchQuery = useQuery({
    queryKey: WATCHLIST_QUERY_KEY,
    queryFn: watchlistApi.list,
    enabled: !!user,
    staleTime: 60_000,
  });
  const watchlist = (user && watchQuery.data?.coins) || EMPTY;

  // One-time import of a watchlist saved in this browser before accounts existed.
  useEffect(() => {
    if (!user || migrating) return;
    const local = readList(WATCHLIST_KEY, WATCHLIST_LIMIT);
    if (!local.length) return;
    migrating = true;
    watchlistApi.add(local)
      .then((data) => { writeList(WATCHLIST_KEY, []); client.setQueryData(WATCHLIST_QUERY_KEY, data); })
      .catch(() => { /* keep local copy; retry next time */ })
      .finally(() => { migrating = false; });
  }, [user, client]);

  useEffect(() => {
    const reload = () => setRecent(readList(key, RECENT_LIMIT));
    reload();
    window.addEventListener('storage', reload);
    window.addEventListener(CHANGE_EVENT, reload);
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

  const clearRecent = useCallback(() => {
    setRecent([]);
    writeList(key, []);
    queueMicrotask(notify);
  }, [key]);

  const toggle = useCallback(async (coinInput: string) => {
    const coin = normalizeCoin(coinInput);
    if (!coin) return;
    // Right after page load the sign-in check may still be running: wait for it
    // instead of telling a signed-in user to sign up.
    const current = user ?? (await client.ensureQueryData({ queryKey: AUTH_KEY, queryFn: fetchMe }).catch(() => null))?.user;
    if (!current) { requestSignIn('watchlist'); return; }
    if (!client.getQueryData(WATCHLIST_QUERY_KEY)) {
      client.setQueryData(WATCHLIST_QUERY_KEY, await watchlistApi.list().catch(() => ({ coins: [] })));
    }
    const previous = client.getQueryData<{ coins: string[] }>(WATCHLIST_QUERY_KEY)?.coins ?? [];
    const removing = previous.includes(coin);
    // Optimistic update, rolled back if the server refuses.
    client.setQueryData(WATCHLIST_QUERY_KEY, { coins: removing ? previous.filter((item) => item !== coin) : [...previous, coin] });
    try {
      client.setQueryData(WATCHLIST_QUERY_KEY, removing ? await watchlistApi.remove(coin) : await watchlistApi.add([coin]));
    } catch (error) {
      client.setQueryData(WATCHLIST_QUERY_KEY, { coins: previous });
      if (error instanceof Error && /Sign in/i.test(error.message)) requestSignIn('watchlist');
      else window.alert(error instanceof Error ? error.message : 'Could not update your watchlist.');
    }
  }, [user, client]);

  const isWatched = useCallback((coin: string) => watchlist.includes(normalizeCoin(coin)), [watchlist]);

  return { recent, watchlist, remember, toggle, isWatched, clearRecent, signedIn: !!user, authLoading };
}

export type CoinMemory = ReturnType<typeof useCoinMemory>;
