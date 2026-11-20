import { useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { validShape } from '@/lib/chart-preferences.js';
import { getChartSetting, setChartSetting, subscribeChartSettings } from '@/lib/chart-settings-store.js';

/**
 * One Super Charts setting, shared by every coin (switching coins keeps it).
 * Invalid or missing saved values fall back to `fallback`.
 */
export function useChartSetting<T>(
  field: string, fallback: T, validate: (value: unknown) => boolean = (value) => validShape(value, fallback),
): [T, Dispatch<SetStateAction<T>>] {
  const stored = useSyncExternalStore(subscribeChartSettings, () => getChartSetting(field), () => undefined);
  const value = stored !== undefined && validate(stored) ? stored as T : fallback;
  const setValue: Dispatch<SetStateAction<T>> = (update) => {
    // Read the latest stored value so quick successive updates compose correctly.
    const latest = getChartSetting(field);
    const current = latest !== undefined && validate(latest) ? latest as T : fallback;
    setChartSetting(field, typeof update === 'function' ? (update as (previous: T) => T)(current) : update);
  };
  return [value, setValue];
}
