import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, RotateCcw, Search, X } from 'lucide-react';
import { CoinLogo } from '@/components/coin-logo';
import { ExchangeLogo } from '@/components/exchange-logo';
import type { MarketContract } from '@/hooks/use-market-contracts';
import '@/styles/market-list.css';

/**
 * Exchange-terminal-style market list for Super Charts: every USDT perpetual on the
 * chart venues with last price and 24h change. Filter by exchange, direction
 * and size of move; sort by any column; colour rows to pick them out; hide
 * rows you don't need (Reset brings everything back). Saved in this browser.
 */

type TickerRow = [symbol: string, last: number, changePercent: number | null, volumeUsd: number | null];
type TickersPayload = {
  exchanges: Record<string, { status: 'ok' | 'stale' | 'loading' | 'unavailable'; updatedAt: string | null; rows: TickerRow[] }>;
  generatedAt: string;
};
type SortKey = 'symbol' | 'last' | 'change' | 'changePercent' | 'volume';
type Move = 'all' | 'gainers' | 'losers';
type Prefs = {
  exchanges: string[]; hidden: string[]; colors: Record<string, string>;
  sort: { key: SortKey; dir: 1 | -1 }; move: Move; minMove: number; colorFilter: string;
};

export const MARKET_LIST_EXCHANGES = ['binance', 'bybit', 'okx', 'gate', 'bitget', 'mexc', 'bingx'];
const EXCHANGE_NAMES: Record<string, string> = {
  binance: 'Binance', bybit: 'Bybit', okx: 'OKX', gate: 'Gate.io', bitget: 'Bitget', mexc: 'MEXC', bingx: 'BingX',
};
export const HIGHLIGHT_COLORS = [
  { id: 'red', value: '#f23645' }, { id: 'orange', value: '#ff9800' }, { id: 'yellow', value: '#f5d33b' },
  { id: 'green', value: '#22ab94' }, { id: 'blue', value: '#2962ff' }, { id: 'purple', value: '#9c27b0' },
];
const COLOR_VALUE = Object.fromEntries(HIGHLIGHT_COLORS.map((color) => [color.id, color.value]));
const KEY = 'cof:v1:market-list';
const DEFAULTS: Prefs = {
  exchanges: MARKET_LIST_EXCHANGES, hidden: [], colors: {},
  sort: { key: 'volume', dir: -1 }, move: 'all', minMove: 0, colorFilter: 'all',
};
const ROW_HEIGHT = 32;

function readPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') return { ...DEFAULTS, ...saved, sort: { ...DEFAULTS.sort, ...saved.sort } };
  } catch { /* storage blocked */ }
  return DEFAULTS;
}

/** Decimals like exchange tickers: fewer for big prices, more for tiny ones. */
export function priceDecimals(price: number): number {
  const abs = Math.abs(price);
  if (!Number.isFinite(abs) || abs === 0) return 2;
  if (abs >= 100) return 2;
  return Math.min(10, Math.max(2, (abs >= 1 ? 4 : 3) - Math.floor(Math.log10(abs))));
}
/** Format a price (or a change) with the decimals of the reference price. */
export function formatPrice(value: number, reference = value): string {
  if (!Number.isFinite(value)) return '—';
  const decimals = priceDecimals(reference);
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
const signed = (text: string, value: number) => (value > 0 ? `+${text}` : text);

type Row = {
  key: string; contract: MarketContract; last: number | null; change: number | null;
  changePercent: number | null; volume: number | null; color: string | undefined;
};

export function MarketList({ contracts, current, onSelect }: {
  contracts: MarketContract[]; current: MarketContract | null; onSelect: (contract: MarketContract) => void;
}) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [query, setQuery] = useState('');
  const [palette, setPalette] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const listRef = useRef<HTMLDivElement>(null);
  const update = (patch: Partial<Prefs>) => setPrefs((previous) => {
    const next = { ...previous, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
    return next;
  });

  const tickers = useQuery({
    queryKey: ['market-tickers'],
    queryFn: async ({ signal }): Promise<TickersPayload> => {
      const response = await fetch('/api/market/tickers', { signal });
      if (!response.ok) throw new Error('Prices unavailable');
      return response.json();
    },
    refetchInterval: 15_000, staleTime: 10_000, retry: 1,
  });

  const prices = useMemo(() => {
    const map = new Map<string, TickerRow>();
    for (const [exchange, entry] of Object.entries(tickers.data?.exchanges ?? {})) {
      for (const row of entry.rows) map.set(`${exchange}:${row[0]}`, row);
    }
    return map;
  }, [tickers.data]);

  const rows = useMemo<Row[]>(() => {
    const hidden = new Set(prefs.hidden);
    const wanted = query.trim().toUpperCase();
    const list: Row[] = [];
    for (const contract of contracts) {
      const exchange = contract.exchange.toLowerCase();
      const key = `${exchange}:${contract.symbol}`;
      if (!prefs.exchanges.includes(exchange) || hidden.has(key)) continue;
      if (wanted && !contract.exchangeAsset.toUpperCase().includes(wanted) && !contract.asset.toUpperCase().includes(wanted)) continue;
      const color = prefs.colors[key];
      if (prefs.colorFilter !== 'all' && color !== prefs.colorFilter) continue;
      const ticker = prices.get(key);
      const last = ticker?.[1] ?? null;
      const changePercent = ticker?.[2] ?? null;
      if (prefs.move === 'gainers' && !(changePercent !== null && changePercent > 0)) continue;
      if (prefs.move === 'losers' && !(changePercent !== null && changePercent < 0)) continue;
      if (prefs.minMove > 0 && !(changePercent !== null && Math.abs(changePercent) >= prefs.minMove)) continue;
      const change = last !== null && changePercent !== null ? last - last / (1 + changePercent / 100) : null;
      list.push({ key, contract, last, change, changePercent, volume: ticker?.[3] ?? null, color });
    }
    const { key: sortKey, dir } = prefs.sort;
    const value = (row: Row) => sortKey === 'last' ? row.last : sortKey === 'change' ? row.change
      : sortKey === 'changePercent' ? row.changePercent : sortKey === 'volume' ? row.volume : null;
    return list.sort((a, b) => {
      if (sortKey === 'symbol') return dir * (a.contract.exchangeAsset.localeCompare(b.contract.exchangeAsset) || a.contract.exchange.localeCompare(b.contract.exchange));
      const left = value(a), right = value(b);
      if (left === null && right === null) return a.contract.exchangeAsset.localeCompare(b.contract.exchangeAsset);
      if (left === null) return 1;
      if (right === null) return -1;
      return dir * (left - right);
    });
  }, [contracts, prices, prefs, query]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!palette) return;
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest?.('.market-list-palette, .market-list-flag')) setPalette(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [palette]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 6);
  const visible = rows.slice(first, first + Math.ceil(viewport / ROW_HEIGHT) + 12);
  const currentKey = current ? `${current.exchange.toLowerCase()}:${current.symbol}` : '';
  const total = contracts.filter((contract) => MARKET_LIST_EXCHANGES.includes(contract.exchange.toLowerCase())).length;
  const filtered = prefs.hidden.length > 0 || prefs.exchanges.length < MARKET_LIST_EXCHANGES.length || prefs.move !== 'all'
    || prefs.minMove > 0 || prefs.colorFilter !== 'all';
  const sortBy = (key: SortKey) => update({ sort: { key, dir: prefs.sort.key === key ? (prefs.sort.dir === 1 ? -1 : 1) : key === 'symbol' ? 1 : -1 } });
  const toggleExchange = (exchange: string) => update({ exchanges: prefs.exchanges.includes(exchange)
    ? prefs.exchanges.filter((item) => item !== exchange) : [...prefs.exchanges, exchange] });
  const setColor = (key: string, color: string | null) => {
    const colors = { ...prefs.colors };
    if (color) colors[key] = color; else delete colors[key];
    update({ colors }); setPalette(null);
  };
  const header = (key: SortKey, label: string, className = '') => (
    <button type="button" className={`market-list-col ${className}${prefs.sort.key === key ? ' is-sorted' : ''}`}
      onClick={() => sortBy(key)} aria-label={`Sort by ${label}`} data-testid={`market-sort-${key}`}>
      {label}{prefs.sort.key === key && (prefs.sort.dir === 1 ? <ArrowUp size={10} aria-hidden="true" /> : <ArrowDown size={10} aria-hidden="true" />)}
    </button>
  );
  const unavailable = Object.entries(tickers.data?.exchanges ?? {})
    .filter(([exchange, entry]) => prefs.exchanges.includes(exchange) && entry.status === 'unavailable').map(([exchange]) => EXCHANGE_NAMES[exchange] ?? exchange);

  return (
    <aside className="market-list" aria-label="Market list" data-testid="market-list">
      <header className="market-list-head">
        <div>
          <div className="market-list-eyebrow">USDT perpetuals · 24h</div>
          <h2>Markets <span>{rows.length.toLocaleString()}{rows.length !== total ? ` / ${total.toLocaleString()}` : ''}</span></h2>
        </div>
        <button type="button" className="market-list-reset" onClick={() => { update({ ...DEFAULTS, colors: prefs.colors }); setQuery(''); }}
          disabled={!filtered && !query} title="Show every coin on every exchange again (keeps your colours)" data-testid="market-reset">
          <RotateCcw size={12} aria-hidden="true" /> Reset
        </button>
      </header>
      <div className="market-list-tools">
        <label className="market-list-search"><Search size={13} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search coin" aria-label="Search coins"
            spellCheck={false} autoCapitalize="characters" data-testid="market-search" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={12} /></button>}
        </label>
        <div className="market-list-exchanges" role="group" aria-label="Exchanges">
          {MARKET_LIST_EXCHANGES.map((exchange) => (
            <button type="button" key={exchange} className={prefs.exchanges.includes(exchange) ? 'is-on' : ''}
              aria-pressed={prefs.exchanges.includes(exchange)} onClick={() => toggleExchange(exchange)}
              title={EXCHANGE_NAMES[exchange]} data-testid={`market-exchange-${exchange}`}>
              <ExchangeLogo exchange={exchange} /><span>{EXCHANGE_NAMES[exchange]}</span>
            </button>
          ))}
        </div>
        <div className="market-list-filters">
          <div className="market-list-move" role="group" aria-label="24h direction">
            {(['all', 'gainers', 'losers'] as Move[]).map((move) => (
              <button type="button" key={move} className={prefs.move === move ? 'is-on' : ''} aria-pressed={prefs.move === move}
                onClick={() => update({ move })} data-testid={`market-move-${move}`}>{move === 'all' ? 'All' : move === 'gainers' ? 'Gainers' : 'Losers'}</button>
            ))}
          </div>
          <label className="market-list-min" title="Only coins that moved at least this much in 24h (up or down)">
            <span>Move ≥</span>
            <input type="number" min="0" max="1000" step="1" value={prefs.minMove || ''} placeholder="0"
              onChange={(event) => { const value = Number(event.target.value); update({ minMove: Number.isFinite(value) && value > 0 ? Math.min(value, 1000) : 0 }); }}
              aria-label="Minimum 24h move percent" data-testid="market-min-move" /><span>%</span>
          </label>
        </div>
        <div className="market-list-colors" role="group" aria-label="Show colour">
          <button type="button" className={prefs.colorFilter === 'all' ? 'is-on' : ''} onClick={() => update({ colorFilter: 'all' })}>All</button>
          {HIGHLIGHT_COLORS.map((color) => (
            <button type="button" key={color.id} className={`market-list-swatch${prefs.colorFilter === color.id ? ' is-on' : ''}`}
              style={{ background: color.value }} onClick={() => update({ colorFilter: prefs.colorFilter === color.id ? 'all' : color.id })}
              aria-label={`Show only ${color.id} coins`} title={`Only ${color.id}`} />
          ))}
        </div>
      </div>
      <div className="market-list-columns">
        {header('symbol', 'Symbol', 'is-symbol')}{header('last', 'Last')}{header('change', 'Chg')}{header('changePercent', 'Chg%')}
      </div>
      <div className="market-list-rows" ref={listRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} role="list">
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          {visible.map((row, index) => {
            const tone = row.changePercent === null ? '' : row.changePercent > 0 ? ' is-up' : row.changePercent < 0 ? ' is-down' : '';
            const color = row.color ? COLOR_VALUE[row.color] : undefined;
            return (
              <div key={row.key} role="listitem" className={`market-list-row${row.key === currentKey ? ' is-current' : ''}${color ? ' is-colored' : ''}`}
                style={{ top: (first + index) * ROW_HEIGHT, ...(color ? { '--row-color': color } as React.CSSProperties : {}) }}
                data-testid={`market-row-${row.key}`}>
                <button type="button" className="market-list-flag" style={color ? { background: color } : undefined}
                  onClick={() => setPalette(palette === row.key ? null : row.key)} aria-label={`Colour ${row.contract.exchangeAsset} on ${EXCHANGE_NAMES[row.contract.exchange] ?? row.contract.exchange}`}
                  title="Colour this row" />
                <button type="button" className="market-list-select" onClick={() => onSelect(row.contract)}
                  aria-current={row.key === currentKey ? 'true' : undefined} title={`${row.contract.exchangeAsset}USDT · ${EXCHANGE_NAMES[row.contract.exchange] ?? row.contract.exchange}`}>
                  <span className="market-list-symbol"><CoinLogo asset={row.contract.asset} />
                    <span className="market-list-name"><b>{row.contract.exchangeAsset}</b><small><ExchangeLogo exchange={row.contract.exchange} />{EXCHANGE_NAMES[row.contract.exchange] ?? row.contract.exchange}</small></span></span>
                  <span className="market-list-num">{row.last === null ? '—' : formatPrice(row.last)}</span>
                  <span className={`market-list-num${tone}`}>{row.change === null ? '—' : signed(formatPrice(row.change, row.last ?? row.change), row.change)}</span>
                  <span className={`market-list-num${tone}`}>{row.changePercent === null ? '—' : `${signed(row.changePercent.toFixed(2), row.changePercent)}%`}</span>
                </button>
                <button type="button" className="market-list-hide" onClick={() => update({ hidden: [...prefs.hidden, row.key] })}
                  aria-label={`Remove ${row.contract.exchangeAsset} on ${EXCHANGE_NAMES[row.contract.exchange] ?? row.contract.exchange} from the list`} title="Remove from list (Reset brings it back)"
                  data-testid={`market-hide-${row.key}`}><X size={12} aria-hidden="true" /></button>
                {palette === row.key && (
                  <div className="market-list-palette" role="menu" aria-label="Row colour">
                    {HIGHLIGHT_COLORS.map((option) => (
                      <button type="button" key={option.id} style={{ background: option.value }} role="menuitem"
                        className={row.color === option.id ? 'is-on' : ''} onClick={() => setColor(row.key, option.id)} aria-label={option.id}
                        data-testid={`market-color-${option.id}`} />
                    ))}
                    <button type="button" className="market-list-palette-clear" onClick={() => setColor(row.key, null)} aria-label="No colour"><X size={11} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!rows.length && <p className="market-list-empty">{contracts.length ? 'No coins match these filters. Press Reset to show all again.' : 'Loading contracts…'}</p>}
      </div>
      <footer className="market-list-foot">
        {tickers.isError ? 'Prices unavailable right now; retrying.' : unavailable.length ? `No prices from ${unavailable.join(', ')} right now.`
          : 'Click a coin to chart it · ● to colour · × to remove · prices refresh every 15–60 s.'}
      </footer>
    </aside>
  );
}
