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
    scaleMin = Math.max(1, points.reduce((min, point) => Math.min(min, point.value), Infinity));
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
          scaleMin = Math.max(1, points.reduce((min, point) => Math.min(min, point.value), Infinity));
          target.useMediaCoordinateSpace(({ context }) => {
            context.save();
            for (const point of [...points].sort((a, b) => b.value - a.value)) {
              const x = timeScale.timeToCoordinate(point.time as Time);
              const y = series.priceToCoordinate(point.nativePrice);
              if (x === null || y === null) continue;
              const radius = bubbleRadius(point.value, maxValue);
              const color = point.side === 'buy' ? '#089981' : '#f23645';
              context.beginPath();
              context.arc(x, y, radius, 0, Math.PI * 2);
              if (point.market === 'spot') {
                context.fillStyle = point.side === 'buy' ? 'rgba(8,153,129,.24)' : 'rgba(242,54,69,.24)';
                context.fill();
                context.lineWidth = 2;
                context.strokeStyle = color;
              } else {
                context.fillStyle = point.side === 'buy' ? 'rgba(8,153,129,.85)' : 'rgba(242,54,69,.85)';
                context.fill();
                context.lineWidth = 1;
                context.strokeStyle = point.side === 'buy' ? 'rgba(214,250,234,1)' : 'rgba(255,222,216,1)';
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

/** Smallest shown bubble per chart (so sizes spread between the smallest and largest). */
let scaleMin = 1;
/**
 * Bubble size from its USD notional on a log scale between the smallest and the
 * largest bubble on screen: a 10x bigger trade is clearly bigger, not just slightly.
 */
function bubbleRadius(value: number, maxValue: number) {
  const low = Math.min(scaleMin, maxValue);
  const span = Math.log(maxValue / low);
  const t = span > 0 ? Math.max(0, Math.min(1, Math.log(Math.max(value, low) / low) / span)) : 1;
  return 5 + 21 * t ** 1.4;
}
