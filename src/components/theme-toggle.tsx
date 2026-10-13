import { useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { nextTheme, resolveTheme, savedTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

function readPreference(): Theme | null {
  try { return savedTheme(window.localStorage.getItem(THEME_STORAGE_KEY)); }
  catch { return null; }
}

export function ThemeToggle() {
  const preference = useRef(readPreference());
  const [theme, setTheme] = useState<Theme>(() =>
    resolveTheme(preference.current, window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false));

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const followSystem = () => {
      if (preference.current === null) setTheme(media?.matches ? 'dark' : 'light');
    };
    const followStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      preference.current = event.key === null ? null : savedTheme(event.newValue);
      setTheme(resolveTheme(preference.current, media?.matches ?? false));
    };
    media?.addEventListener('change', followSystem);
    window.addEventListener('storage', followStorage);
    return () => {
      media?.removeEventListener('change', followSystem);
      window.removeEventListener('storage', followStorage);
    };
  }, []);

  const toggle = () => {
    const chosen = nextTheme(theme);
    preference.current = chosen;
    setTheme(chosen);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, chosen); }
    catch { /* Keep the toggle functional when browser storage is unavailable. */ }
  };
  const target = nextTheme(theme);
  return <button type="button" className="theme-toggle" onClick={toggle} aria-pressed={theme === 'dark'}
    aria-label={`Switch to ${target} mode`} title={`Switch to ${target} mode`} data-testid="button-theme-toggle">
    {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    <span className="theme-toggle-label">{target === 'dark' ? 'Dark' : 'Light'}</span>
  </button>;
}
