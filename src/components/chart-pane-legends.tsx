import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Settings2, X } from 'lucide-react';
import { helpFor } from '@/lib/indicator-help';
import '@/styles/chart-pane-legends.css';

export type LegendRow = {
  /** Layer key (study id, orderflow id, 'price', 'volume'). */
  key: string;
  label: string;
  params?: string;
  color?: string;
  values?: Array<{ text: string; color?: string }>;
};
export type LegendPane = { key: string; top: number; rows: LegendRow[] };

type Props = {
  panes: LegendPane[];
  settings: Record<string, ReactNode | undefined>;
  onRemove?: (key: string) => void;
};

/**
 * TradingView-style labels at the top-left of every chart pane: name, inputs
 * and live values, with ⚙ (settings + how to read it) and × (remove).
 */
export function ChartPaneLegends({ panes, settings, onRemove }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (panel.current?.contains(target) || target.closest?.('.pane-legend-gear')) return;
      setOpen(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  return (
    <div className="pane-legends" aria-label="Chart layers">
      {panes.map((pane) => (
        <div className="pane-legend" key={pane.key} style={{ top: pane.top + 6 }}>
          {pane.rows.map((row) => {
            const help = helpFor(row.key);
            const hasPanel = Boolean(settings[row.key] || help);
            const isOpen = open === row.key;
            return (
              <div className="pane-legend-row" key={row.key} data-testid={`legend-${row.key}`}>
                {row.color && <i className="pane-legend-swatch" style={{ background: row.color }} aria-hidden="true" />}
                <span className="pane-legend-name">{row.label}</span>
                {row.params && <span className="pane-legend-params">{row.params}</span>}
                {row.values?.map((value, index) => (
                  <span key={index} className="pane-legend-value" style={value.color ? { color: value.color } : undefined}>{value.text}</span>
                ))}
                {hasPanel && (
                  <button type="button" className={`pane-legend-gear${isOpen ? ' is-open' : ''}`} aria-expanded={isOpen}
                    aria-label={`${row.label} settings and explanation`} title="Settings & how to read it"
                    onClick={() => setOpen(isOpen ? null : row.key)} data-testid={`legend-gear-${row.key}`}>
                    <Settings2 size={13} aria-hidden="true" />
                  </button>
                )}
                {onRemove && row.key !== 'price' && (
                  <button type="button" className="pane-legend-remove" aria-label={`Remove ${row.label}`} title="Remove"
                    onClick={() => onRemove(row.key)}><X size={12} aria-hidden="true" /></button>
                )}
                {isOpen && (
                  <div className="pane-legend-panel" ref={panel} role="dialog" aria-label={`${row.label} settings`} data-testid={`legend-panel-${row.key}`}>
                    <header><strong>{row.label}</strong>
                      <button type="button" onClick={() => setOpen(null)} aria-label="Close"><X size={14} /></button></header>
                    {settings[row.key] && <section className="pane-legend-settings"><h4>Settings</h4>{settings[row.key]}</section>}
                    {help && <section className="pane-legend-help"><h4>How to read it</h4>
                      <p>{help.summary}</p>
                      {help.lines?.length ? <dl>{help.lines.map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}</dl> : null}
                      {help.signals?.length ? <><h5>Signals</h5><ul>{help.signals.map((signal) => <li key={signal}>{signal}</li>)}</ul></> : null}
                    </section>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
