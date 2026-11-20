import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { chartSettingsSnapshot, onChartSettingsChange, replaceChartSettings } from '@/lib/chart-settings-store.js';

const URL = '/api/me/prefs/super-charts';
const save = (value: Record<string, unknown>) => fetch(URL, {
  method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }),
}).catch(() => { /* next change retries */ });

/**
 * Signed in: load this account's Super Charts setup (indicators, settings,
 * timeframe, favourites) and save changes back shortly after they happen.
 */
export function useChartSettingsSync() {
  const { user } = useAuth();
  const email = user?.email;
  useEffect(() => {
    if (!email) return;
    let ready = false, cancelled = false, timer: number | undefined;
    void (async () => {
      try {
        const response = await fetch(URL, { credentials: 'same-origin' });
        if (!response.ok || cancelled) return;
        const { value } = await response.json() as { value: Record<string, unknown> | null };
        if (cancelled) return;
        // Account has a saved setup: use it. New account: keep what is on screen and save it.
        if (value) replaceChartSettings(value); else void save(chartSettingsSnapshot());
        ready = true;
      } catch { /* offline: keep the current setup */ }
    })();
    const off = onChartSettingsChange((state) => {
      if (!ready) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void save(state); }, 700);
    });
    return () => { cancelled = true; off(); window.clearTimeout(timer); };
  }, [email]);
}
