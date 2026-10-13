import catalog from '../data/coin-logo-index.json' with { type: 'json' };
import overrides from '../data/coin-logo-overrides.json' with { type: 'json' };
import gateCatalog from '../data/gate-coin-logos.json' with { type: 'json' };

const identities: Record<string, number> = {
  ...catalog.ids,
  ...Object.fromEntries(Object.entries(overrides).map(([ticker, identity]) => [ticker, identity.id])),
};
const legacySymbols = new Set(catalog.legacySymbols);
const exchangeLogos: Record<string, { name: string; url: string }> = gateCatalog.logos;
const aliases: Record<string, string> = {
  XBT: 'BTC', XDG: 'DOGE', BTCPERP: 'BTC', ETHPERP: 'ETH',
  FILECOIN: 'FIL', PUMPFUN: 'PUMP', KPEPE: 'PEPE',
  KBONK: 'BONK', KSHIB: 'SHIB', KDOGE: 'DOGE', KFLOKI: 'FLOKI',
};
// These screener symbols represent non-crypto contracts, not similarly named tokens.
const nonCrypto = new Set([
  'NATGAS', 'NGAS', 'NG', 'GVZ', 'RUM', 'XAU', 'XAG', 'XPT', 'XPD',
  'UKOIL', 'USOIL', 'BRENT', 'WTI', 'SPX500', 'NAS100', 'SPY', 'QQQ',
  'AAPL', 'AMZN', 'MSFT', 'GOOGL', 'GOOG', 'META', 'NVDA', 'NVIDIA',
  'TSLA', 'COIN', 'COINBASE', 'MSTR', 'CRCL', 'SNDK', 'SKHY', 'SKHYNIX',
  'SAMSUNG', 'MU', 'INTC', 'AMD', 'AVGO', 'MRVL', 'ORCL', 'RBLX',
  'OPENAI', 'ANTHROPIC', 'SPCX', 'EWY', 'GBP', 'ETN', 'HPQ', 'KOD',
  'SPIR', 'SDGR', 'KOPN', 'NDX100', 'SP500',
]);

export function coinLogoTicker(asset: string): string | null {
  let ticker = asset.trim().normalize('NFKC').toUpperCase();
  if (!/^[\p{L}\p{N}$-]{1,40}$/u.test(ticker) || nonCrypto.has(ticker) || ticker.endsWith('STOCK')) return null;
  ticker = aliases[ticker] ?? ticker;
  if (ticker.endsWith('PERP') && identities[ticker.slice(0, -4)]) ticker = ticker.slice(0, -4);
  const underlying = ticker.replace(/^(?:100000|10000|1000|100)(?=\p{L})/u, '');
  if (identities[underlying] || exchangeLogos[underlying]) ticker = underlying;
  return aliases[ticker] ?? ticker;
}

export function coinLogoUrls(asset: string): string[] {
  const ticker = coinLogoTicker(asset);
  if (!ticker) return [];
  const identity = identities[ticker];
  const exchangeLogo = exchangeLogos[ticker]?.url;
  if (!identity) return exchangeLogo ? [exchangeLogo] : [];
  const urls = [
    `https://s2.coinmarketcap.com/static/img/coins/64x64/${identity}.png`,
    `https://s2.coinmarketcap.com/static/img/coins/200x200/${identity}.png`,
  ];
  if (exchangeLogo) urls.push(exchangeLogo);
  if (legacySymbols.has(ticker)) {
    urls.push(`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${ticker.toLowerCase()}.png`);
    urls.push(`https://assets.coincap.io/assets/icons/${ticker.toLowerCase()}@2x.png`);
  }
  return urls;
}

export function coinLogoUrl(asset: string): string | null {
  return coinLogoUrls(asset)[0] ?? null;
}
