import { useState } from 'react';
import { coinLogoUrls } from '@/lib/coin-logos';

const failedLogoUrls = new Set<string>();

export function CoinLogo({ asset }: { asset: string }) {
  const [attempt, setAttempt] = useState({ asset, index: 0 });
  const candidates = coinLogoUrls(asset);
  const index = candidates.findIndex((url, candidateIndex) =>
    candidateIndex >= (attempt.asset === asset ? attempt.index : 0) && !failedLogoUrls.has(url));
  const url = candidates[index];
  if (!url) {
    return <span className="coin-logo coin-logo-fallback" title={`Logo unavailable for ${asset}`} aria-hidden="true">{asset.slice(0, 2)}</span>;
  }
  return <img className="coin-logo" src={url} alt="" width={24} height={24}
    loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => {
      failedLogoUrls.add(url);
      setAttempt({ asset, index: index + 1 });
    }} />;
}
