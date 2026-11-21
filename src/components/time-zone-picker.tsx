import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clock } from 'lucide-react';
import { TIME_ZONES, offsetLabel, useTimeZone } from '@/lib/time-zone';
import '@/styles/language-picker.css';

/** Header time zone menu (next to the language menu): chart times are shown in this zone. */
export function TimeZonePicker() {
  const [zone, setZone] = useTimeZone();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    root.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: 'center' });
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  return (
    <div className="lang-picker tz-picker" ref={root}>
      <button type="button" className="lang-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        title="Time zone for chart times" data-testid="time-zone-trigger">
        <Clock size={14} aria-hidden="true" /><span className="lang-code">{offsetLabel(zone)}</span><ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="lang-menu tz-menu" role="menu" aria-label="Time zone">
          <div className="lang-menu-title">Chart time zone</div>
          <ul>
          {TIME_ZONES.map((item) => (
            <li key={item.id} role="none">
              <button type="button" role="menuitemradio" aria-checked={item.id === zone} className={item.id === zone ? 'is-selected' : ''}
                onClick={() => { setZone(item.id); setOpen(false); }} data-testid={`time-zone-${item.id}`}>
                <span className="tz-offset">{offsetLabel(item.id)}</span><span className="lang-name">{item.label}</span>
                {item.id === zone && <Check size={13} aria-hidden="true" />}
              </button>
            </li>
          ))}
          </ul>
        </div>
      )}
    </div>
  );
}
