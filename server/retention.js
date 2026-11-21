// How long recorded history is kept. Server settings (environment variables) so a
// small server can be set lighter (e.g. RECORD_DAYS=30, BUBBLE_HOURS=24) without code changes:
//   RECORD_DAYS   order flow (CVD), liquidations, open interest, long/short ratios, funding (default 120)
//   BUBBLE_HOURS  Aggressive Volume Bubbles (default 720 = 30 days)
//   PROFILE_DAYS  Session Volume Profile (default = RECORD_DAYS)
const read = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};
export const RECORD_DAYS = read("RECORD_DAYS", 120, 2, 365);
export const BUBBLE_HOURS = read("BUBBLE_HOURS", 720, 1, 24 * 365);
export const PROFILE_DAYS = read("PROFILE_DAYS", RECORD_DAYS, 1, 365);
