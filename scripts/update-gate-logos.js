import { readFile, writeFile } from 'node:fs/promises';
import { requestJson } from '../server/exchangeRequests.js';

const root = new URL('../src/data/', import.meta.url);
const index = JSON.parse(await readFile(new URL('coin-logo-index.json', root), 'utf8'));
const currencies = await requestJson('https://api.gateio.ws/api/v4/spot/currencies');
const active = new Map();
for (const coin of currencies) {
  if (!coin.delisted && coin.name && /^[\p{L}\p{N}$-]{1,40}$/u.test(coin.currency)) {
    active.set(coin.currency.toUpperCase(), coin.name);
  }
}
let requested = null;
const inventoryIndex = process.argv.indexOf('--inventory');
if (inventoryIndex >= 0) {
  const file = process.argv[inventoryIndex + 1];
  if (!file) throw new Error('--inventory requires a saved market snapshot JSON file');
  const inventory = JSON.parse(await readFile(file, 'utf8'));
  requested = new Set((inventory.rows ?? []).map(row => row.asset.toUpperCase()));
} else if (process.env.REPLIT_DEV_DOMAIN) {
  requested = new Set();
  for (const route of ['funding?timeframe=current', 'lsar?maxPrice=all']) {
    const response = await fetch(`https://${process.env.REPLIT_DEV_DOMAIN}/api/market/${route}`,
      { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Cannot inspect current inventory: HTTP ${response.status}`);
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Preview proxy returned a non-JSON page. Use --inventory with a saved API snapshot.');
    }
    const snapshot = await response.json();
    for (const row of snapshot.rows ?? []) requested.add(row.asset.toUpperCase());
  }
}
const entries = [...active].filter(([symbol]) => !index.ids[symbol] && (!requested || requested.has(symbol)));
console.log(`Checking ${entries.length} exchange-listed tokens missing a primary logo.`);
let previous = {};
try { previous = JSON.parse(await readFile(new URL('gate-coin-logos.json', root), 'utf8')).logos; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const logos = { ...previous };
let cursor = 0;
let checked = 0;
let stopped = false;
async function worker() {
  while (!stopped && cursor < entries.length) {
    const [symbol, name] = entries[cursor++];
    if (logos[symbol]?.name === name) continue;
    await new Promise(resolve => setTimeout(resolve, 150));
    if (stopped) return;
    const url = `https://icon.staticimgs.com/images/coin_icon/64/${encodeURIComponent(symbol.toLowerCase())}.png`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (response.status === 429) {
        stopped = true;
        throw new Error('Logo CDN rate limit reached; stop this maintenance run');
      }
      if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 0 && bytes.byteLength < 1_000_000) logos[symbol] = { name, url };
      } else await response.body?.cancel();
    } catch (error) {
      if (error.message.includes('rate limit')) throw error;
    }
    checked++;
    if (checked % 50 === 0) console.log(`Checked ${checked}/${entries.length}; verified ${Object.keys(logos).length} exchange logos.`);
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
await writeFile(new URL('gate-coin-logos.json', root), JSON.stringify({
  updatedAt: new Date().toISOString(),
  source: 'https://api.gateio.ws/api/v4/spot/currencies',
  logos,
}));
console.log(`Saved ${Object.keys(logos).length} verified exchange-hosted logo links.`);
