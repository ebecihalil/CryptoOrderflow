export function coinLogoUrl(asset: string): string | null {
  const ticker = asset.trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(ticker)
    ? `https://assets.coincap.io/assets/icons/${ticker}@2x.png` : null;
}
