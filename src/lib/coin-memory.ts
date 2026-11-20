// Per-visitor coin memory: recently viewed coins per section and one personal
// watchlist shared by every section. Stored only in this browser
// (localStorage), so each person sees their own lists without an account.
// Storage can be unavailable (private mode, blocked site data); every access is
// guarded and the site works without it.

export type CoinSection = 'lsar-global' | 'lsar-top' | 'funding' | 'open-interest' | 'leverage' | 'super-charts';

export const RECENT_LIMIT = 8;
export const WATCHLIST_LIMIT = 50;
const PREFIX = 'cof:v1:';
export const WATCHLIST_KEY = `${PREFIX}watchlist`;
export const recentKey = (section: CoinSection) => `${PREFIX}recent:${section}`;

/** Canonical display key for a coin: trimmed, upper-case, letters/digits only. */
export function normalizeCoin(value: string): string {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30);
}

/** Most-recent-first, de-duplicated, bounded. */
export function pushRecent(list: readonly string[], coin: string, limit = RECENT_LIMIT): string[] {
  const key = normalizeCoin(coin);
  if (!key) return [...list];
  return [key, ...list.filter((item) => item !== key)].slice(0, limit);
}

export function toggleWatch(list: readonly string[], coin: string, limit = WATCHLIST_LIMIT): string[] {
  const key = normalizeCoin(coin);
  if (!key) return [...list];
  if (list.includes(key)) return list.filter((item) => item !== key);
  return [...list, key].slice(-limit);
}

export function parseList(raw: string | null, limit: number): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of value) {
      const key = typeof item === 'string' ? normalizeCoin(item) : '';
      if (key && !seen.has(key)) { seen.add(key); out.push(key); }
    }
    return out.slice(0, limit);
  } catch {
    return [];
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function readList(key: string, limit: number, store: StorageLike | null = storage()): string[] {
  try { return parseList(store?.getItem(key) ?? null, limit); } catch { return []; }
}

export function writeList(key: string, list: readonly string[], store: StorageLike | null = storage()): void {
  try { store?.setItem(key, JSON.stringify(list)); } catch { /* storage full/blocked: keep in memory only */ }
}
