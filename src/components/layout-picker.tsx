import { useEffect, useRef, useState } from 'react';
import { CELL_AREAS, CHART_LAYOUTS, gridStyle, layoutById, type ChartLayout } from '@/lib/chart-layouts';

function LayoutIcon({ layout }: { layout: ChartLayout }) {
  return (
    <span className="layout-icon" style={gridStyle(layout)} aria-hidden="true">
      {CELL_AREAS.slice(0, layout.count).map((area) => <i key={area} style={{ gridArea: area }} />)}
    </span>
  );
}

/** Chart layout menu: 1, 2, 3 or 4 charts in different arrangements. */
export type LayoutSync = { symbol: boolean; interval: boolean; crosshair: boolean; time: boolean; range: boolean };
export const DEFAULT_LAYOUT_SYNC: LayoutSync = { symbol: false, interval: false, crosshair: true, time: false, range: false };
const SYNC_OPTIONS: Array<[keyof LayoutSync, string, string]> = [
  ['symbol', 'Symbol', 'Every chart shows the same coin.'],
  ['interval', 'Interval', 'Every chart uses the same timeframe.'],
  ['crosshair', 'Crosshair', 'Moving the cursor on one chart shows the same moment on the others.'],
  ['time', 'Time', 'Scrolling one chart scrolls the others to the same time (each keeps its zoom).'],
  ['range', 'Date range', 'Zooming or scrolling keeps the exact same date range on all charts.'],
];

export function LayoutPicker({ value, onChange, sync, onSyncChange }: {
  value: string; onChange: (id: string) => void; sync: LayoutSync; onSyncChange: (next: LayoutSync) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="layout-picker" ref={root}>
      <button type="button" className="layout-trigger" aria-haspopup="true" aria-expanded={open} title="Chart layout"
        onClick={() => setOpen(!open)} data-testid="layout-trigger"><LayoutIcon layout={layoutById(value)} /></button>
      {open && (
        <div className="layout-menu" role="menu" aria-label="Chart layout">
          {[1, 2, 3, 4].map((count) => (
            <div className="layout-row" key={count}>
              <span className="layout-count">{count}</span>
              {CHART_LAYOUTS.filter((layout) => layout.count === count).map((layout) => (
                <button type="button" key={layout.id} role="menuitemradio" aria-checked={layout.id === value} title={layout.label}
                  className={layout.id === value ? 'is-on' : ''} onClick={() => { onChange(layout.id); setOpen(false); }}
                  data-testid={`layout-${layout.id}`}><LayoutIcon layout={layout} /></button>
              ))}
            </div>
          ))}
          <div className="layout-sync" role="group" aria-label="Sync in layout">
            <div className="layout-sync-title">Sync in layout</div>
            {SYNC_OPTIONS.map(([key, label, help]) => (
              <label key={key} className="layout-sync-row" title={help}>
                <span>{label} <i aria-hidden="true">i</i></span>
                <input type="checkbox" role="switch" checked={sync[key]} onChange={(event) => onSyncChange({ ...sync, [key]: event.target.checked })}
                  data-testid={`layout-sync-${key}`} />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
