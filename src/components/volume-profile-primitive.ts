import type { IPrimitivePaneRenderer, ISeriesApi, ISeriesPrimitive, ITimeScaleApi, Logical, SeriesType, Time } from 'lightweight-charts';
import type { SessionProfile, VolumeProfileSettings } from '@/lib/volume-profile';

type Context = {
  series: ISeriesApi<SeriesType>;
  timeScale: ITimeScaleApi<Time>;
  /** Candle times (s), ascending: used to place session start/end on the time axis. */
  times: number[];
  profiles: SessionProfile[];
  settings: VolumeProfileSettings;
};

const COLORS = {
  up: 'rgba(30,158,171,', down: 'rgba(161,39,82,', vaUp: 'rgba(36,186,199,', vaDown: 'rgba(219,44,106,',
  box: 'rgba(9,30,31,0.22)', poc: '#ffffff', developingPoc: '#e5e7eb', va: '#5091ff',
};

/** Fractional bar index of a time (extrapolated past either end of the data). */
function logicalOf(times: number[], time: number): number | null {
  const n = times.length;
  if (!n) return null;
  const step = n > 1 ? times[n - 1] - times[n - 2] : 60;
  if (time <= times[0]) return (time - times[0]) / (n > 1 ? times[1] - times[0] : step);
  if (time >= times[n - 1]) return n - 1 + (time - times[n - 1]) / step;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= time) lo = mid; else hi = mid; }
  return lo + (time - times[lo]) / (times[hi] - times[lo]);
}

/** Session volume profiles drawn behind the candles: one histogram per session, POC/VA lines. */
export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null;
  constructor(private context: Context) {}
  attached(param: { requestUpdate: () => void }) { this.requestUpdate = param.requestUpdate; }
  update(context: Context) { this.context = context; this.requestUpdate?.(); }

  paneViews() {
    return [{
      zOrder: () => 'bottom' as const,
      renderer: () => ({
        draw: (target: Parameters<IPrimitivePaneRenderer['draw']>[0]) => {
          const { series, timeScale, times, profiles, settings } = this.context;
          target.useMediaCoordinateSpace(({ context }) => {
            const xAt = (time: number) => {
              const logical = logicalOf(times, time);
              return logical === null ? null : timeScale.logicalToCoordinate(logical as Logical);
            };
            for (const profile of profiles) {
              const x1 = xAt(profile.start), x2 = xAt(profile.end);
              const yTop = series.priceToCoordinate(profile.high), yBottom = series.priceToCoordinate(profile.low);
              if (x1 === null || x2 === null || yTop === null || yBottom === null || x2 - x1 < 2) continue;
              // Session box.
              context.fillStyle = COLORS.box;
              context.fillRect(x1, yTop, x2 - x1, yBottom - yTop);
              const maxWidth = (x2 - x1) * Math.max(0.05, Math.min(1, settings.width / 100));
              const right = settings.placement === 'right';
              for (const row of profile.rows) {
                const volume = row.up + row.down;
                if (!(volume > 0) || !(profile.maxRow > 0)) continue;
                const ya = series.priceToCoordinate(row.high), yb = series.priceToCoordinate(row.low);
                if (ya === null || yb === null) continue;
                const height = Math.max(1, Math.abs(yb - ya) - 0.5), top = Math.min(ya, yb);
                const width = Math.max(1, volume / profile.maxRow * maxWidth);
                const upWidth = width * row.up / volume;
                const intensity = Math.min(1, volume / profile.maxRow * (row.inValueArea ? 1.18 : 1));
                const alpha = (0.32 + intensity * 0.6).toFixed(2);
                const start = right ? x2 - width : x1;
                if (row.up > 0) { context.fillStyle = `${row.inValueArea ? COLORS.vaUp : COLORS.up}${alpha})`; context.fillRect(start, top, upWidth, height); }
                if (row.down > 0) { context.fillStyle = `${row.inValueArea ? COLORS.vaDown : COLORS.down}${alpha})`; context.fillRect(start + upWidth, top, width - upWidth, height); }
              }
              const line = (price: number, color: string, width: number, dash: number[] = []) => {
                const y = series.priceToCoordinate(price);
                if (y === null) return;
                context.save(); context.strokeStyle = color; context.lineWidth = width; context.setLineDash(dash);
                context.beginPath(); context.moveTo(x1, y); context.lineTo(x2, y); context.stroke(); context.restore();
              };
              if (settings.showPoc) line(profile.poc, profile.developing ? COLORS.developingPoc : COLORS.poc, 2, profile.developing ? [4, 3] : []);
              if (settings.showVa) { line(profile.vah, COLORS.va, 1); line(profile.val, COLORS.va, 1); }
            }
          });
        },
      }),
    }];
  }
}
