import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { FLAG_URLS } from '@/lib/flags';
import { LANGUAGES, useI18n } from '@/lib/i18n';
import '@/styles/language-picker.css';

function Flag({ country }: { country: string }) {
  return <img className="lang-flag" src={FLAG_URLS[country]} alt="" width={20} height={15} aria-hidden="true" />;
}

/** Header language menu: flag + code, opens a list of languages with flags. */
export function LanguagePicker() {
  const { lang, language, setLanguage, t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLElement>('button')?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    list.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  const move = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className="lang-picker" ref={root}>
      <button type="button" className="lang-trigger" aria-haspopup="true" aria-expanded={open}
        aria-label={`${t('Language')}: ${language.name}`} title={t('Language')}
        onClick={() => setOpen(!open)} data-testid="button-language">
        <Flag country={language.flag} />
        <span className="lang-code">{language.code.toUpperCase()}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="lang-menu" role="menu" aria-label={t('Language')} onKeyDown={move}>
          <div className="lang-menu-title">{t('Language')}</div>
          <ul ref={list}>
            {LANGUAGES.map((item) => (
              <li key={item.code}>
                <button type="button" role="menuitemradio" aria-checked={item.code === lang} lang={item.code}
                  className={item.code === lang ? 'is-selected' : ''} data-testid={`language-${item.code}`}
                  onClick={() => { setLanguage(item.code); setOpen(false); }}>
                  <Flag country={item.flag} />
                  <span className="lang-name">{item.name}</span>
                  {item.name !== item.english && <small lang="en">{item.english}</small>}
                  {item.code === lang && <Check size={13} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
