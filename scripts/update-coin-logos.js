import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { requestJson } from '../server/exchangeRequests.js';
import overrides from '../src/data/coin-logo-overrides.json' with { type: 'json' };

// Explicit identities for major assets whose symbols are also used by unrelated tokens.
export const VERIFIED_IDS = Object.fromEntries(
  Object.entries(overrides).map(([symbol, entry]) => [symbol, entry.id]),
);

const normalizedName = value => value?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') ?? '';

export function buildLogoCatalog(coins, legacyIcons, exchangeCoins = []) {
  const names = new Map();
  for (const coin of [...legacyIcons, ...exchangeCoins]) {
    const symbol = coin.symbol?.trim().toUpperCase();
    const name = normalizedName(coin.name);
    if (!symbol || !name || name === normalizedName(symbol)) continue;
    const set = names.get(symbol) ?? new Set();
    set.add(name);
    names.set(symbol, set);
  }
  const bySymbol = new Map();
  for (const coin of coins) {
    const symbol = coin.symbol?.trim().toUpperCase();
    if (!symbol || !/^[\p{L}\p{N}$-]{1,40}$/u.test(symbol) || coin.isActive !== 1
      || !Number.isSafeInteger(coin.id) || coin.id <= 0 || !(coin.marketPairCount > 0)) continue;
    const group = bySymbol.get(symbol) ?? new Map();
    group.set(coin.id, coin);
    bySymbol.set(symbol, group);
  }
  const logos = {};
  const ambiguous = [];
  for (const [symbol, entries] of bySymbol) {
    const candidates = [...entries.values()];
    const nameMatches = candidates.filter(coin => names.get(symbol)?.has(normalizedName(coin.name)));
    const listedMatches = candidates.filter(coin => coin.tags?.includes('binance-listing'));
    const chosen = candidates.find(coin => coin.id === VERIFIED_IDS[symbol])
      ?? (listedMatches.length === 1 ? listedMatches[0] : null)
      ?? (nameMatches.length === 1 ? nameMatches[0] : null)
      ?? (candidates.length === 1 ? candidates[0] : null);
    if (!chosen) { ambiguous.push(symbol); continue; }
    logos[symbol] = { id: chosen.id, name: chosen.name };
  }
  return {
    updatedAt: new Date().toISOString(),
    sources: [
      'https://coinmarketcap.com/',
      'https://github.com/spothq/cryptocurrency-icons',
      'https://www.gate.com/', 'https://www.bybit.com/', 'https://www.mexc.com/',
    ],
    logos,
    ambiguous: ambiguous.sort(),
    legacySymbols: legacyIcons.filter(item => {
      const symbol = item.symbol?.toUpperCase();
      return symbol && logos[symbol] && normalizedName(logos[symbol].name) === normalizedName(item.name);
    }).map(item => item.symbol.toUpperCase()),
  };
}

export function buildLogoIndex(catalog) {
  return {
    ids: Object.fromEntries(Object.entries(catalog.logos).map(([symbol, coin]) => [symbol, coin.id])),
    legacySymbols: catalog.legacySymbols,
  };
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Logo catalog request failed: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const coins = [];
  // Manual maintenance only: never called by page refresh or application startup.
  for (const start of [1, 5001]) {
    if (start > 1) await new Promise(resolve => setTimeout(resolve, 2000));
    const result = await readJson(`https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=${start}&limit=5000&sortBy=market_cap&sortType=desc&convert=USD&cryptoType=all&tagType=all&audited=false`);
    if (result.status?.error_code !== '0' || !Array.isArray(result.data?.cryptoCurrencyList)) {
      throw new Error('Logo catalog provider returned an invalid listing');
    }
    coins.push(...result.data.cryptoCurrencyList);
  }
  const legacy = await readJson('https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/manifest.json');
  const exchangeCoins = [];
  const providers = [
    ['https://api.gateio.ws/api/v4/spot/currencies',
      data => data.filter(coin => !coin.delisted).map(coin => ({ symbol: coin.currency, name: coin.name }))],
    ['https://api.mexc.com/api/v3/exchangeInfo',
      data => data.symbols.filter(coin => coin.isSpotTradingAllowed).map(coin => ({ symbol: coin.baseAsset, name: coin.fullName }))],
    ['https://api2.bybit.com/spot/api/basic/symbol_list_v3',
      data => data.result.quoteTokenResult.flatMap(quote => quote.quoteTokenSymbols
        .filter(coin => coin.si.endsWith(quote.tokenId))
        .map(coin => ({ symbol: coin.si.slice(0, -quote.tokenId.length), name: coin.tfn })))],
  ];
  for (const [url, extract] of providers) {
    try { exchangeCoins.push(...extract(await requestJson(url))); }
    catch (error) { console.warn(`Skipped exchange name verification: ${new URL(url).hostname}: ${error.message}`); }
  }
  const catalog = buildLogoCatalog(coins, legacy, exchangeCoins);
  const output = new URL('../src/data/coin-logo-catalog.json', import.meta.url);
  await mkdir(path.dirname(fileURLToPath(output)), { recursive: true });
  await writeFile(output, JSON.stringify(catalog));
  await writeFile(new URL('../src/data/coin-logo-index.json', import.meta.url), JSON.stringify(buildLogoIndex(catalog)));
  console.log(`Saved ${Object.keys(catalog.logos).length} coin logo identities; ${catalog.ambiguous.length} ambiguous tickers withheld.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
