import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clearChartSettings } from '@/lib/chart-settings-store.js';
import { clearChartPreferences } from '@/lib/chart-preferences.js';

export type AuthUser = { email: string };

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`);
  return data as T;
}

export const AUTH_KEY = ['auth-me'] as const;
export const WATCHLIST_QUERY_KEY = ['me-watchlist'] as const;

export const fetchMe = () => send<{ user: AuthUser | null }>('GET', '/api/auth/me');

export function useAuth() {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: AUTH_KEY,
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: AUTH_KEY }),
    client.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY }),
  ]);
  const signUp = useMutation({
    mutationFn: (input: { email: string; password: string }) => send<{ user: AuthUser }>('POST', '/api/auth/signup', input),
    onSuccess: refresh,
  });
  const signIn = useMutation({
    mutationFn: (input: { email: string; password: string }) => send<{ user: AuthUser }>('POST', '/api/auth/login', input),
    onSuccess: refresh,
  });
  const signOut = useMutation({
    mutationFn: () => send<{ user: null }>('POST', '/api/auth/logout', {}),
    onSuccess: () => {
      client.setQueryData(AUTH_KEY, { user: null });
      client.setQueryData(WATCHLIST_QUERY_KEY, { coins: [] });
      client.removeQueries({ queryKey: ['me-prefs'] });
      resetLocalAccountData();
    },
  });
  return { user: me.data?.user ?? null, loading: me.isPending, signUp, signIn, signOut };
}

export const watchlistApi = {
  list: () => send<{ coins: string[] }>('GET', '/api/me/watchlist'),
  add: (coins: string[]) => send<{ coins: string[] }>('POST', '/api/me/watchlist', coins.length === 1 ? { coin: coins[0] } : { coins }),
  remove: (coin: string) => send<{ coins: string[] }>('DELETE', `/api/me/watchlist/${encodeURIComponent(coin)}`),
};

/**
 * Sign-out: this browser goes back to the defaults (Super Charts indicators,
 * settings, timeframe, market list, recent coins, chart zoom). Language and
 * theme stay. Signing in again brings the account's setup back.
 */
export const SIGNED_OUT_EVENT = 'cof-signed-out';
export function resetLocalAccountData() {
  clearChartSettings();
  clearChartPreferences();
  try {
    const keep = new Set(['cof:v1:language']);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('cof:v1:') && !keep.has(key)) localStorage.removeItem(key);
    }
  } catch { /* storage blocked */ }
  try { window.dispatchEvent(new Event(SIGNED_OUT_EVENT)); } catch { /* ignore */ }
}

// ---- "Sign up to use your watchlist" prompt, opened from anywhere ----
const PROMPT_EVENT = 'cof-auth-prompt';
export function requestSignIn(reason = 'watchlist') {
  try { window.dispatchEvent(new CustomEvent(PROMPT_EVENT, { detail: reason })); } catch { /* ignore */ }
}
export function onSignInRequest(listener: (reason: string) => void) {
  const handler = (event: Event) => listener(String((event as CustomEvent).detail ?? 'watchlist'));
  window.addEventListener(PROMPT_EVENT, handler);
  return () => window.removeEventListener(PROMPT_EVENT, handler);
}

/** Only same-site paths are allowed as post-login destinations. */
export function safeNext(value: string | null | undefined) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}
