import { useSyncExternalStore } from 'react';
import { I18N_KEYS, LANGUAGES, type Language } from './i18n-keys.js';
import { I18N_TEXT } from './i18n-text.js';

export { LANGUAGES, type Language };

const KEY = 'cof:v1:language';
const RTL = new Set(['ar', 'ur']);
const tables = new Map<string, Map<string, string>>();
const listeners = new Set<() => void>();

function table(code: string) {
  let map = tables.get(code);
  if (!map && I18N_TEXT[code]) {
    const lines = I18N_TEXT[code].split('\n');
    map = new Map(I18N_KEYS.map((key, index) => [key, lines[index]]));
    tables.set(code, map);
  }
  return map;
}

const known = (code: string | null | undefined) => LANGUAGES.some((language) => language.code === code);

/** Saved choice, else the browser's language when offered, else English. */
function initial(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (known(saved)) return saved!;
  } catch { /* storage blocked */ }
  for (const tag of typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]) {
    const base = tag?.toLowerCase().split('-')[0];
    const code = base === 'tl' ? 'fil' : base;
    if (known(code)) return code;
  }
  return 'en';
}

let current = initial();
function apply() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.documentElement.dataset.lang = current;
}
apply();

export function setLanguage(code: string) {
  if (!known(code) || code === current) return;
  current = code;
  try { localStorage.setItem(KEY, code); } catch { /* storage blocked */ }
  apply();
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Translate English interface text; unknown text is returned unchanged. */
export function translate(text: string, code = current): string {
  return code === 'en' ? text : table(code)?.get(text) ?? text;
}

export function useI18n() {
  const lang = useSyncExternalStore(subscribe, () => current, () => 'en');
  const language = LANGUAGES.find((item) => item.code === lang) ?? LANGUAGES[0];
  return { lang, language, rtl: RTL.has(lang), setLanguage, t: (text: string) => translate(text, lang) };
}
