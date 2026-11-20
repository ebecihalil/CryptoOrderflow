import type { IPrimitivePaneRenderer, ISeriesApi, ISeriesPrimitive, ITimeScaleApi, SeriesType, Time } from 'lightweight-charts';

export type BandPoint = { time: number; upper: number | null; lower: number | null };
type Context = {
  series: ISeriesApi<SeriesType>;
  timeScale: ITimeScaleApi<Time>;
  points: BandPoint[];
  /** Fill when upper >= lower, and when lower > upper (e.g. Ichimoku cloud colours). */
  up: string;
  down: string;
};

/** Shades the area between two price lines on the series' pane (below candles). */
export class BandFillPrimitive implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null;
  constructor(private context: Context) {}
  attached(param: { requestUpdate: () => void }) { this.requestUpdate = param.requestUpdate; }
  update(context: Context) { this.context = context; this.requestUpdate?.(); }

  paneViews() {
    return [{
      zOrder: () => 'bottom' as const,
      renderer: () => ({
        draw: (target: Parameters<IPrimitivePaneRenderer['draw']>[0]) => {
          const { series, timeScale, points, up, down } = this.context;
          target.useMediaCoordinateSpace(({ context }) => {
            // Build runs of consecutive drawable points with the same orientation.
            let run: Array<{ x: number; yU: number; yL: number }> = [];
            let runUp = true;
            const flush = () => {
              if (run.length > 1) {
                context.beginPath();
                context.moveTo(run[0].x, run[0].yU);
                for (const p of run.slice(1)) context.lineTo(p.x, p.yU);
                for (const p of [...run].reverse()) context.lineTo(p.x, p.yL);
                context.closePath();
                context.fillStyle = runUp ? up : down;
                context.fill();
              }
              run = [];
            };
            for (const point of points) {
              if (point.upper === null || point.lower === null) { flush(); continue; }
              const x = timeScale.timeToCoordinate(point.time as Time);
              const yU = series.priceToCoordinate(point.upper);
              const yL = series.priceToCoordinate(point.lower);
              if (x === null || yU === null || yL === null) { flush(); continue; }
              const isUp = point.upper >= point.lower;
              if (run.length && isUp !== runUp) {
                // Close the previous run at this x so colours meet without a gap.
                run.push({ x, yU, yL });
                const last = run[run.length - 1];
                flush();
                run.push(last);
              }
              runUp = isUp;
              run.push({ x, yU, yL });
            }
            flush();
          });
        },
      }),
    }];
  }
}
