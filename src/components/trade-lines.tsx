// TradingView-style trading lines on the price pane: the order being drafted (qty | type | side),
// its TP / SL (drag the handles to set them), open positions (entry, TP, SL) and open orders.
// Lines are HTML over the chart, positioned with the candle series' price <-> pixel mapping.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import '@/styles/trading.css';

export type TradeLine = {
  id: string;
  price: number;
  color: string;
  /** Text in the label box, e.g. "500 | Limit". */
  text: string;
  /** Coloured chip after the box ("Buy", "Sell", a PnL). */
  chip?: { text: string; color: string };
  /** Placeholder handle (TP / SL not set yet) drawn this many pixels from `price`, without a line. */
  ghostOffset?: number;
  dashed?: boolean;
  draggable?: boolean;
  onDrag?: (price: number) => void;
  onDrop?: (price: number) => void;
  onCancel?: () => void;
};

type Api = { chart: IChartApi; candleSeries: ISeriesApi<SeriesType> } | null;

export function TradeLines({ lines, getApi, paneTop, paneHeight, format }: {
  lines: TradeLine[]; getApi: () => Api; paneTop: number; paneHeight: number; format: (price: number) => string;
}) {
  const [layout, setLayout] = useState<{ ys: Record<string, number | null>; scale: number }>({ ys: {}, scale: 60 });
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const drag = useRef<{ id: string; ghost: number } | null>(null);
  const dragY = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Follow scrolling / zooming / price-scale changes every frame while lines are shown.
  useEffect(() => {
    if (!lines.length) return;
    let frame = 0, last = '';
    const loop = () => {
      const api = getApi();
      if (api) {
        const ys: Record<string, number | null> = {};
        for (const line of linesRef.current) {
          if (drag.current?.id === line.id && dragY.current !== null) { ys[line.id] = dragY.current; continue; }
          const y = api.candleSeries.priceToCoordinate(line.price);
          ys[line.id] = y === null ? null : y + (line.ghostOffset ?? 0);
        }
        const scale = api.chart.priceScale('right').width();
        const key = JSON.stringify([ys, scale]);
        if (key !== last) { last = key; setLayout({ ys, scale }); }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [lines.length, getApi]);

  const priceAt = (clientY: number) => {
    const api = getApi(), root = rootRef.current;
    if (!api || !root) return null;
    const y = clientY - root.getBoundingClientRect().top - paneTop;
    const price = api.candleSeries.coordinateToPrice(Math.max(0, Math.min(paneHeight, y)));
    return price === null ? null : Number(price);
  };
  const onPointerDown = (line: TradeLine) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!line.draggable) return;
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { id: line.id, ghost: line.ghostOffset ?? 0 };
  };
  const onPointerMove = (line: TradeLine) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== line.id) return;
    const root = rootRef.current;
    if (!root) return;
    dragY.current = Math.max(0, Math.min(paneHeight, event.clientY - root.getBoundingClientRect().top - paneTop));
    const price = priceAt(event.clientY);
    if (price !== null && price > 0) line.onDrag?.(price);
  };
  const onPointerUp = (line: TradeLine) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== line.id) return;
    drag.current = null; dragY.current = null;
    const price = priceAt(event.clientY);
    if (price !== null && price > 0) line.onDrop?.(price);
  };

  if (!lines.length) return null;
  return (
    <div className="trade-lines" ref={rootRef} style={{ top: 0, height: paneTop + paneHeight }} aria-label="Trading lines">
      {lines.map((line) => {
        const y = layout.ys[line.id];
        if (y === null || y === undefined || y < 0 || y > paneHeight) return null;
        const ghost = line.ghostOffset !== undefined;
        return (
          <div key={line.id} className={`trade-line${ghost ? ' is-ghost' : ''}`} style={{ top: paneTop + y, right: 0 }} data-testid={`trade-line-${line.id}`}>
            {!ghost && <i className="trade-line-rule" style={{ borderTopColor: line.color, borderTopStyle: line.dashed ? 'dashed' : 'solid', right: layout.scale }} />}
            <div className="trade-line-group" style={{ right: layout.scale + 8 }}>
              <div className={`trade-line-label${line.draggable ? ' is-draggable' : ''}`} style={{ borderColor: line.color }}
                onPointerDown={onPointerDown(line)} onPointerMove={onPointerMove(line)} onPointerUp={onPointerUp(line)} onPointerCancel={onPointerUp(line)}
                title={line.draggable ? 'Drag to move' : undefined}>
                <span className="trade-line-text">{line.text}</span>
                {line.draggable && <span className="trade-line-grip" aria-hidden="true">⠿</span>}
              </div>
              {line.chip && <span className="trade-line-chip" style={{ background: line.chip.color }}>{line.chip.text}</span>}
              {line.onCancel && <button type="button" className="trade-line-cancel" style={{ borderColor: line.color, color: line.color }}
                onClick={line.onCancel} aria-label="Cancel" title="Cancel">−</button>}
            </div>
            {!ghost && <span className="trade-line-price" style={{ background: line.color, width: layout.scale }}>{format(line.price)}</span>}
          </div>
        );
      })}
    </div>
  );
}
