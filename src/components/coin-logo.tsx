import { useState } from 'react';
import { coinLogoUrl } from '@/lib/coin-logos';

export function CoinLogo({ asset }: { asset: string }) {
  const [failed, setFailed] = useState(false);
  const url = coinLogoUrl(asset);
  if (!url || failed) {
    return <span className="coin-logo coin-logo-fallback" title={`Logo unavailable for ${asset}`} aria-hidden="true">{asset.slice(0, 2)}</span>;
  }
  return <img className="coin-logo" src={url} alt="" width={24} height={24}
    loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
