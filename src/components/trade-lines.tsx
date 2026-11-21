// TradingView-style trading lines on the price pane: the order being drafted (qty | type | side),
// open positions and open orders. Inactive TP / SL handles sit ON the order / position line
// (outlined only); drag one away to activate it, which draws a filled green (TP) / red (SL) line.
// Lines are HTML over the chart, positioned with the candle series' price <-> pixel mapping.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import '@/styles/trading.css';

/** An inactive TP / SL handle sitting on a line; dropping it elsewhere activates it at that price. */
export type TradeHandle = { id: string; text: string; color: string; onDrop: (price: number) => void };

export type TradeLine = {
  id: string;
  price: number;
  color: string;
  /** Text in the label box, e.g. "500 | Limit". */
  text: string;
  /** Solid background in the line colour (active TP / SL). */
  filled?: boolean;
  /** Coloured chip after the box ("Buy", "Sell", a PnL). */
  chip?: { text: string; color: string };
  /** Inactive TP / SL handles shown on this line. */
  handles?: TradeHandle[];
  dashed?: boolean;
  draggable?: boolean;
  onDrag?: (price: number) => void;
  onDrop?: (price: number) => void;
  onCancel?: () => void;
};

type Api = { chart: IChartApi; candleSeries: ISeriesApi<SeriesType> } | null;
type Drag = { key: string; y: number | null; text: string; color: string };

export function TradeLines({ lines, getApi, paneTop, paneHeight, format }: {
  lines: TradeLine[]; getApi: () => Api; paneTop: number; paneHeight: number; format: (price: number) => string;
}) {
  const [layout, setLayout] = useState<{ ys: Record<string, number | null>; scale: number }>({ ys: {}, scale: 60 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const rootRef = useRef<HTMLDivElement>(null);

  // Follow scrolling / zooming / price-scale changes every frame while lines are shown.
  useEffect(() => {
    if (!lines.length) return;
    let frame = 0, last = '';
    const loop = () => {
      const api = getApi();
      if (api) {
        const ys: Record<string, number | null> = {};
        for (const line of linesRef.current) ys[line.id] = api.candleSeries.priceToCoordinate(line.price);
        const scale = api.chart.priceScale('right').width();
        const key = JSON.stringify([ys, scale]);
        if (key !== last) { last = key; setLayout({ ys, scale }); }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [lines.length, getApi]);

  const yAt = (clientY: number) => {
    const root = rootRef.current;
    return root ? Math.max(0, Math.min(paneHeight, clientY - root.getBoundingClientRect().top - paneTop)) : null;
  };
  const priceAt = (clientY: number) => {
    const api = getApi(), y = yAt(clientY);
    if (!api || y === null) return null;
    const price = api.candleSeries.coordinateToPrice(y);
    return price === null ? null : Number(price);
  };
  /** Pointer handlers for a draggable element (a line label or a handle). */
  const dragHandlers = (key: string, text: string, color: string, onMove?: (price: number) => void, onDrop?: (price: number) => void) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault(); event.stopPropagation();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      setDrag({ key, y: null, text, color });
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (dragRef.current?.key !== key) return;
      setDrag({ key, y: yAt(event.clientY), text, color });
      const price = priceAt(event.clientY);
      if (price !== null && price > 0) onMove?.(price);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      if (dragRef.current?.key !== key) return;
      const moved = dragRef.current.y !== null;
      setDrag(null);
      const price = priceAt(event.clientY);
      if (moved && price !== null && price > 0) onDrop?.(price);
    },
    onPointerCancel: () => setDrag(null),
  });

  if (!lines.length) return null;
  const dragPrice = drag?.y != null ? getApi()?.candleSeries.coordinateToPrice(drag.y) : null;
  return (
    <div className="trade-lines" ref={rootRef} style={{ top: 0, height: paneTop + paneHeight }} aria-label="Trading lines">
      {lines.map((line) => {
        // A line being dragged follows the pointer.
        const y = drag?.key === line.id && drag.y !== null ? drag.y : layout.ys[line.id];
        if (y === null || y === undefined || y < 0 || y > paneHeight) return null;
        const labelStyle = line.filled ? { borderColor: line.color, background: line.color, color: '#fff' } : { borderColor: line.color };
        return (
          <div key={line.id} className={`trade-line${line.filled ? ' is-filled' : ''}`} style={{ top: paneTop + y, right: 0 }} data-testid={`trade-line-${line.id}`}>
            <i className="trade-line-rule" style={{ borderTopColor: line.color, borderTopStyle: line.dashed ? 'dashed' : 'solid', right: layout.scale }} />
            <div className="trade-line-group" style={{ right: layout.scale + 8 }}>
              {line.handles?.map((handle) => (
                <span key={handle.id} className="trade-line-handle" style={{ borderColor: handle.color, color: handle.color,
                  visibility: drag?.key === handle.id ? 'hidden' : undefined }} title={`Drag to set ${handle.text}`}
                  {...dragHandlers(handle.id, handle.text, handle.color, undefined, handle.onDrop)} data-testid={`trade-handle-${handle.id}`}>
                  {handle.text} <span className="trade-line-grip" aria-hidden="true">⠿</span></span>
              ))}
              <div className={`trade-line-label${line.draggable ? ' is-draggable' : ''}`} style={labelStyle}
                {...(line.draggable ? dragHandlers(line.id, line.text, line.color, line.onDrag, line.onDrop) : {})}
                title={line.draggable ? 'Drag to move' : undefined}>
                <span className="trade-line-text">{line.text}</span>
                {line.draggable && <span className="trade-line-grip" aria-hidden="true">⠿</span>}
              </div>
              {line.chip && <span className="trade-line-chip" style={{ background: line.chip.color }}>{line.chip.text}</span>}
              {line.onCancel && <button type="button" className="trade-line-cancel" style={{ borderColor: line.color, color: line.color }}
                onClick={line.onCancel} aria-label="Cancel" title="Remove">−</button>}
            </div>
            <span className="trade-line-price" style={{ background: line.color, width: layout.scale }}>{format(drag?.key === line.id && dragPrice ? Number(dragPrice) : line.price)}</span>
          </div>
        );
      })}
      {/* A TP / SL handle being dragged off its line: preview line at the pointer. */}
      {drag && drag.y !== null && !lines.some((line) => line.id === drag.key) && (
        <div className="trade-line is-filled" style={{ top: paneTop + drag.y, right: 0 }}>
          <i className="trade-line-rule" style={{ borderTopColor: drag.color, borderTopStyle: 'dashed', right: layout.scale }} />
          <div className="trade-line-group" style={{ right: layout.scale + 8 }}>
            <div className="trade-line-label" style={{ borderColor: drag.color, background: drag.color, color: '#fff' }}>{drag.text}</div>
          </div>
          {dragPrice && <span className="trade-line-price" style={{ background: drag.color, width: layout.scale }}>{format(Number(dragPrice))}</span>}
        </div>
      )}
    </div>
  );
}

/** Centre-of-chart confirmation for TP / SL changes on an open position. */
export function TradeConfirm({ text, onConfirm, onCancel, busy }: { text: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  return (
    <div className="trade-confirm" role="dialog" aria-label="Confirm TP / SL change" data-testid="trade-confirm">
      <span>{text}</span>
      <button type="button" className="trade-save" onClick={onConfirm} disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</button>
      <button type="button" className="trade-close" onClick={onCancel}>Cancel</button>
    </div>
  );
}
