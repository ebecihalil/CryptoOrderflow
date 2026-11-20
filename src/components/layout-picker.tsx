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
export function LayoutPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
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
        </div>
      )}
    </div>
  );
}
