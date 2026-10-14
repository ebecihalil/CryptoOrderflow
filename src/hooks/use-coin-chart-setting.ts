import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { coinPreferenceKey, readChartPreference, writeChartPreference } from '@/lib/chart-preferences.js';

export function useCoinChartSetting<T>(
  asset: string, field: string, fallback: T, validate?: (value: unknown) => boolean,
): [T, Dispatch<SetStateAction<T>>] {
  const key = asset ? coinPreferenceKey(asset, field) : '';
  const load = () => readChartPreference(key, fallback, validate) as T;
  const [entry, setEntry] = useState(() => ({ key, value: load() }));
  // Read the new coin immediately, not in an effect which could write the old
  // coin's settings under the new key during a fast switch.
  const value = entry.key === key ? entry.value : load();
  const currentRef = useRef(value);
  currentRef.current = value;
  const setValue: Dispatch<SetStateAction<T>> = (update) => {
    const next = typeof update === 'function' ? (update as (value: T) => T)(currentRef.current) : update;
    currentRef.current = next;
    writeChartPreference(key, next);
    setEntry({ key, value: next });
  };
  return [value, setValue];
}
