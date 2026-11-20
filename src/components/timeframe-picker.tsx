import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Star } from 'lucide-react';
import { ALL_TIMEFRAMES, TIMEFRAME_LABELS } from '../../server/timeframes.js';
import '@/styles/timeframe-picker.css';

const KEY = 'cof:v1:tf-favorites';
export const DEFAULT_FAVORITE_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '24h'];
const GROUPS: Array<[string, string[]]> = [
  ['Seconds', ['1s', '5s', '15s', '30s']],
  ['Minutes', ['1m', '3m', '5m', '15m', '30m']],
  ['Hours', ['1h', '4h']],
  ['Days & longer', ['24h', '1w', '1mo', '3mo']],
];

function readFavorites(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(value)) return value.filter((tf) => ALL_TIMEFRAMES.includes(tf));
  } catch { /* storage blocked */ }
  return DEFAULT_FAVORITE_TIMEFRAMES;
}

/**
 * TradingView-style timeframe control: starred favourites as quick buttons,
 * plus a dropdown with every timeframe (☆ to add/remove favourites).
 */
export function TimeframePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [favorites, setFavorites] = useState<string[]>(readFavorites);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  const toggleFavorite = (tf: string) => setFavorites((current) => {
    const next = current.includes(tf) ? current.filter((item) => item !== tf) : [...current, tf];
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
    return next;
  });
  const quick = ALL_TIMEFRAMES.filter((tf) => favorites.includes(tf));

  return (
    <div className="tf-picker" ref={root}>
      <div className="super-chart-timeframes" role="group" aria-label="Favourite timeframes">
        {quick.map((tf) => (
          <button key={tf} type="button" className={value === tf ? 'active' : ''} aria-pressed={value === tf}
            onClick={() => onChange(tf)} data-testid={`tf-${tf}`}>{TIMEFRAME_LABELS[tf]}</button>
        ))}
      </div>
      <button type="button" className={`tf-picker-trigger${quick.includes(value) ? '' : ' is-current'}`} aria-haspopup="true" aria-expanded={open}
        onClick={() => setOpen(!open)} data-testid="tf-dropdown" title="All timeframes">
        {quick.includes(value) ? 'More' : TIMEFRAME_LABELS[value] ?? value}<ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="tf-picker-menu" role="menu" aria-label="All timeframes">
          {GROUPS.map(([group, frames]) => (
            <div key={group} role="group" aria-label={group}>
              <div className="tf-picker-group">{group}</div>
              {frames.map((tf) => (
                <div key={tf} className={`tf-picker-row${value === tf ? ' is-selected' : ''}`}>
                  <button type="button" role="menuitemradio" aria-checked={value === tf} className="tf-picker-select"
                    onClick={() => { onChange(tf); setOpen(false); }} data-testid={`tf-option-${tf}`}>
                    {TIMEFRAME_LABELS[tf]}{group === 'Seconds' && <small>live trades</small>}
                  </button>
                  <button type="button" className={`tf-picker-star${favorites.includes(tf) ? ' is-on' : ''}`}
                    aria-pressed={favorites.includes(tf)} aria-label={`${favorites.includes(tf) ? 'Remove' : 'Add'} ${TIMEFRAME_LABELS[tf]} ${favorites.includes(tf) ? 'from' : 'to'} favourites`}
                    onClick={() => toggleFavorite(tf)} data-testid={`tf-star-${tf}`}>
                    <Star size={13} aria-hidden="true" fill={favorites.includes(tf) ? 'currentColor' : 'none'} />
                  </button>
                </div>
              ))}
            </div>
          ))}
          <p>☆ a timeframe to pin it next to this menu.</p>
        </div>
      )}
    </div>
  );
}
