const SUFFIXES = { 1: '', 1000: 'K', 1000000: 'M', 1000000000: 'B' };

/** Display only: calculations and sorting keep the original numeric quantity. */
export function formatOiUnits(value, asset) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  let scale = magnitude >= 1e9 ? 1e9 : magnitude >= 1e6 ? 1e6 : magnitude >= 1e3 ? 1e3 : 1;
  // Avoid displaying 1,000K or 1,000M at a rounding boundary.
  if (scale > 1 && scale < 1e9 && Math.round(magnitude / scale * 100) / 100 >= 1000) scale *= 1000;
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: scale === 1 ? 6 : 2,
  }).format(value / scale);
  return `${formatted}${SUFFIXES[scale]} ${asset}`;
}
