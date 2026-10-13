import type {
  IPrimitivePaneRenderer,
  ISeriesApi,
  ISeriesPrimitive,
  ITimeScaleApi,
  Logical,
  Time,
} from 'lightweight-charts';
import type { LiquidityZone } from '@/lib/liquidity-zones';

type ZoneStyle = {
  resistance: string;
  support: string;
  inside: string;
  transparency: number;
};

type PrimitiveContext = {
  series: ISeriesApi<'Candlestick'>;
  timeScale: ITimeScaleApi<Time>;
  zones: LiquidityZone[];
  candles: Array<{ time: number }>;
  style: ZoneStyle;
};

export class LiquidityZonePrimitive implements ISeriesPrimitive<Time> {
  private context: PrimitiveContext;
  private requestUpdate: (() => void) | null = null;

  constructor(context: PrimitiveContext) {
    this.context = context;
  }

  attached(param: { requestUpdate: () => void }): void {
    this.requestUpdate = param.requestUpdate;
  }

  update(context: PrimitiveContext): void {
    this.context = context;
    this.requestUpdate?.();
  }

  paneViews() {
    return [{
      zOrder: () => 'bottom' as const,
      renderer: () => ({
        draw: (target: Parameters<IPrimitivePaneRenderer['draw']>[0]) => {
          const { series, zones, candles, style } = this.context;
          const { timeScale } = this.context;
          const visibleRange = timeScale.getVisibleLogicalRange();
          target.useMediaCoordinateSpace(({ context, mediaSize }) => {
            const alpha = 1 - Math.min(100, Math.max(0, style.transparency)) / 100;
            for (const zone of zones) {
              const candleIndex = candles.findIndex((candle) => candle.time === zone.leftTime);
              let left = timeScale.timeToCoordinate(zone.leftTime as Time);
              if (left === null && candleIndex >= 0) left = timeScale.logicalToCoordinate(candleIndex as Logical);
              if (left === null) {
                if (candleIndex < 0 || (visibleRange && candleIndex > visibleRange.to)) continue;
                left = 0;
              }
              const top = series.priceToCoordinate(zone.top);
              const bottom = series.priceToCoordinate(zone.bottom);
              if (top === null || bottom === null || left >= mediaSize.width) continue;
              const fill = zone.status === 'support' ? style.support : zone.status === 'resistance' ? style.resistance : style.inside;
              const y = Math.min(top, bottom);
              const height = Math.max(1, Math.abs(bottom - top));
              context.globalAlpha = alpha;
              context.fillStyle = fill;
              context.fillRect(Math.max(0, left), y, Math.max(0, mediaSize.width - Math.max(0, left)), height);
            }
            context.globalAlpha = 1;
          });
        },
      }),
    }];
  }
}
