// Display time zone for chart times (axis, crosshair, labels). Candles themselves are
// always exchange candles (they start at UTC midnight); only how their times are shown changes.
import { useChartSetting } from '@/hooks/use-chart-setting';

export const LOCAL_ZONE = 'local';
/** Common zones (IANA names); "local" = this computer's zone. */
export const TIME_ZONES: Array<{ id: string; label: string }> = [
  { id: LOCAL_ZONE, label: 'Local (this computer)' },
  { id: 'UTC', label: 'UTC' },
  { id: 'Pacific/Honolulu', label: 'Honolulu' },
  { id: 'America/Anchorage', label: 'Anchorage' },
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
  { id: 'America/Vancouver', label: 'Vancouver' },
  { id: 'America/Denver', label: 'Denver' },
  { id: 'America/Phoenix', label: 'Phoenix' },
  { id: 'America/Chicago', label: 'Chicago' },
  { id: 'America/Mexico_City', label: 'Mexico City' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Toronto', label: 'Toronto' },
  { id: 'America/Bogota', label: 'Bogotá' },
  { id: 'America/Caracas', label: 'Caracas' },
  { id: 'America/Santiago', label: 'Santiago' },
  { id: 'America/Sao_Paulo', label: 'São Paulo' },
  { id: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
  { id: 'Atlantic/Reykjavik', label: 'Reykjavik' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Lisbon', label: 'Lisbon' },
  { id: 'Europe/Madrid', label: 'Madrid' },
  { id: 'Europe/Paris', label: 'Paris' },
  { id: 'Europe/Berlin', label: 'Berlin' },
  { id: 'Europe/Amsterdam', label: 'Amsterdam' },
  { id: 'Europe/Zurich', label: 'Zurich' },
  { id: 'Europe/Rome', label: 'Rome' },
  { id: 'Europe/Warsaw', label: 'Warsaw' },
  { id: 'Africa/Lagos', label: 'Lagos' },
  { id: 'Africa/Cairo', label: 'Cairo' },
  { id: 'Africa/Johannesburg', label: 'Johannesburg' },
  { id: 'Europe/Athens', label: 'Athens' },
  { id: 'Europe/Kiev', label: 'Kyiv' },
  { id: 'Europe/Istanbul', label: 'Istanbul' },
  { id: 'Europe/Moscow', label: 'Moscow' },
  { id: 'Asia/Riyadh', label: 'Riyadh' },
  { id: 'Asia/Tehran', label: 'Tehran' },
  { id: 'Asia/Dubai', label: 'Dubai' },
  { id: 'Asia/Karachi', label: 'Karachi' },
  { id: 'Asia/Kolkata', label: 'Kolkata / Mumbai' },
  { id: 'Asia/Kathmandu', label: 'Kathmandu' },
  { id: 'Asia/Dhaka', label: 'Dhaka' },
  { id: 'Asia/Bangkok', label: 'Bangkok' },
  { id: 'Asia/Jakarta', label: 'Jakarta' },
  { id: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh' },
  { id: 'Asia/Singapore', label: 'Singapore' },
  { id: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { id: 'Asia/Shanghai', label: 'Shanghai' },
  { id: 'Asia/Taipei', label: 'Taipei' },
  { id: 'Asia/Manila', label: 'Manila' },
  { id: 'Asia/Seoul', label: 'Seoul' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Australia/Perth', label: 'Perth' },
  { id: 'Australia/Brisbane', label: 'Brisbane' },
  { id: 'Australia/Sydney', label: 'Sydney' },
  { id: 'Pacific/Auckland', label: 'Auckland' },
];

const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
/** IANA zone for a setting value ('local' → this computer's zone). */
export const resolveZone = (id: string) => (id === LOCAL_ZONE ? browserZone() : id);

/** "UTC+3", "UTC−5:30", "UTC" for a zone at a moment. */
export function offsetLabel(id: string, at = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: resolveZone(id), timeZoneName: 'shortOffset' }).formatToParts(new Date(at));
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
    return name === 'GMT' || name === 'GMT+0' ? 'UTC' : name.replace('GMT', 'UTC').replace('-', '−');
  } catch { return 'UTC'; }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string, options: Intl.DateTimeFormatOptions) {
  const key = `${zone}|${JSON.stringify(options)}`;
  let value = formatters.get(key);
  if (!value) {
    try { value = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: zone }); }
    catch { value = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }); }
    formatters.set(key, value);
  }
  return value;
}
const part = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((item) => item.type === type)?.value ?? '';

/** Formatters for lightweight-charts (times are unix seconds). */
export function chartTimeFormatters(id: string) {
  const zone = resolveZone(id);
  return {
    /** Crosshair label: "21 Nov '26 07:00". */
    timeFormatter: (time: number) => {
      const parts = formatter(zone, { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time * 1000));
      return `${part(parts, 'day')} ${part(parts, 'month')} '${part(parts, 'year')} ${part(parts, 'hour')}:${part(parts, 'minute')}`;
    },
    /** Axis labels by tick type: 0 year, 1 month, 2 day, 3 time, 4 time with seconds. */
    tickMarkFormatter: (time: number, type: number) => {
      const date = new Date(time * 1000);
      if (type === 0) return formatter(zone, { year: 'numeric' }).format(date);
      if (type === 1) return formatter(zone, { month: 'short' }).format(date);
      if (type === 2) return formatter(zone, { day: 'numeric' }).format(date);
      const parts = formatter(zone, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
      return type === 4 ? `${part(parts, 'hour')}:${part(parts, 'minute')}:${part(parts, 'second')}`
        : `${part(parts, 'hour')}:${part(parts, 'minute')}`;
    },
  };
}

/** The chosen display zone (saved with the chart settings, so it follows the account). */
export function useTimeZone() {
  return useChartSetting<string>('timeZone', LOCAL_ZONE, (value) => typeof value === 'string' && TIME_ZONES.some((zone) => zone.id === value));
}
