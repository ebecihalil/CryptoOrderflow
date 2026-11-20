export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'lsar-theme';

export function savedTheme(value: string | null): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/** First visit (nothing saved): dark. After that, the visitor's own choice. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function resolveTheme(value: string | null, _systemDark = false): Theme {
  return savedTheme(value) ?? 'dark';
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
