export function sourceFailureLabel(error?: string | null): string | null {
  if (error?.includes('HTTP 418')) return 'IP blocked';
  if (error?.includes('HTTP 429')) return 'rate limited';
  if (error?.includes('HTTP 451')) return 'access restricted';
  return null;
}
