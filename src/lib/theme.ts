export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'lsar-theme';

export function savedTheme(value: string | null): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

export function resolveTheme(value: string | null, systemDark: boolean): Theme {
  return savedTheme(value) ?? (systemDark ? 'dark' : 'light');
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
