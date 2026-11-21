// How long recorded history is kept. Server settings (environment variables) so a
// small server stays light and a big one keeps long history without code changes:
//   RECORD_DAYS   order flow (CVD), liquidations, open interest, long/short ratios, funding (default 30)
//   BUBBLE_HOURS  Aggressive Volume Bubbles (default 24)
//   PROFILE_DAYS  Session Volume Profile (default = RECORD_DAYS)
const read = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};
export const RECORD_DAYS = read("RECORD_DAYS", 30, 2, 365);
export const BUBBLE_HOURS = read("BUBBLE_HOURS", 24, 1, 24 * 365);
export const PROFILE_DAYS = read("PROFILE_DAYS", RECORD_DAYS, 1, 365);
