import type {
  IPrimitivePaneRenderer, ISeriesApi, ISeriesPrimitive, ITimeScaleApi, PrimitiveHoveredItem, Time,
} from 'lightweight-charts';
import type { AggressiveBubble } from '@/hooks/use-aggressive-bubbles';

export type PlottedAggressiveBubble = AggressiveBubble & { nativePrice: number };

type BubbleContext = {
  series: ISeriesApi<'Candlestick'>;
  timeScale: ITimeScaleApi<Time>;
  points: PlottedAggressiveBubble[];
  enabled: boolean;
};

export class AggressiveBubblesPrimitive implements ISeriesPrimitive<Time> {
  private context: BubbleContext;
  private requestUpdate: (() => void) | null = null;

  constructor(context: BubbleContext) {
    this.context = context;
  }

  attached(param: { requestUpdate: () => void }): void {
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.requestUpdate = null;
  }

  update(context: BubbleContext): void {
    this.context = context;
    this.requestUpdate?.();
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const point = this.findBubbleAt(x, y);
    return point ? { externalId: point.id, zOrder: 'top', cursorStyle: 'crosshair', hitTestPriority: 2 } : null;
  }

  findBubbleAt(x: number, y: number): PlottedAggressiveBubble | null {
    if (!this.context.enabled) return null;
    const { series, timeScale, points } = this.context;
    const maxValue = Math.max(1, points.reduce((max, point) => Math.max(max, point.value), 0));
    let nearest: PlottedAggressiveBubble | null = null;
    let nearestDistance = Infinity;
    for (const point of points) {
      const px = timeScale.timeToCoordinate(point.time as Time);
      const py = series.priceToCoordinate(point.nativePrice);
      if (px === null || py === null) continue;
      const radius = bubbleRadius(point.value, maxValue) + 5;
      const distance = Math.hypot(px - x, py - y);
      if (distance <= radius && distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  paneViews() {
    return [{
      zOrder: () => 'top' as const,
      renderer: () => ({
        draw: (target: Parameters<IPrimitivePaneRenderer['draw']>[0]) => {
          const { series, timeScale, points, enabled } = this.context;
          if (!enabled || !points.length) return;
          const maxValue = Math.max(1, points.reduce((max, point) => Math.max(max, point.value), 0));
          target.useMediaCoordinateSpace(({ context }) => {
            context.save();
            for (const point of [...points].sort((a, b) => b.value - a.value)) {
              const x = timeScale.timeToCoordinate(point.time as Time);
              const y = series.priceToCoordinate(point.nativePrice);
              if (x === null || y === null) continue;
              const radius = bubbleRadius(point.value, maxValue);
              const color = point.side === 'buy' ? '#58b77d' : '#d66e68';
              context.beginPath();
              context.arc(x, y, radius, 0, Math.PI * 2);
              if (point.market === 'spot') {
                context.fillStyle = point.side === 'buy' ? 'rgba(88,183,125,.12)' : 'rgba(214,110,104,.12)';
                context.fill();
                context.lineWidth = 2;
                context.strokeStyle = color;
              } else {
                context.fillStyle = point.side === 'buy' ? 'rgba(88,183,125,.64)' : 'rgba(214,110,104,.64)';
                context.fill();
                context.lineWidth = 1;
                context.strokeStyle = point.side === 'buy' ? 'rgba(190,238,204,.88)' : 'rgba(255,205,198,.88)';
              }
              context.stroke();
              // Label every bubble, including the smallest qualifying trades.
              // A contrasting outline keeps letters legible on both themes.
              const label = point.market === 'spot' ? 'S' : 'P';
              context.font = `600 ${Math.max(8, Math.min(11, radius * 0.65))}px monospace`;
              context.textAlign = 'center';
              context.textBaseline = 'middle';
              context.lineWidth = 2;
              context.strokeStyle = 'rgba(13,30,26,.9)';
              context.strokeText(label, x, y);
              context.fillStyle = '#f5fff7';
              context.fillText(label, x, y);
            }
            context.restore();
          });
        },
      }),
    }];
  }
}

function bubbleRadius(value: number, maxValue: number) {
  const magnitude = Math.sqrt(Math.max(0, value) / maxValue);
  return Math.max(5, Math.min(20, magnitude * 20));
}
