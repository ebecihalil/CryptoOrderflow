import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { SIGNED_OUT_EVENT, useAuth } from '@/hooks/use-auth';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Lock, LogIn, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { assignSlot, groupByPriority, moveSlot, normalizeSlots } from '@/lib/market-priority';
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
  hidden: string[]; colors: Record<string, string>;
  /** Exchange priority for "one row per coin" (first = preferred). */
  /** Ten priority slots (exchange id or empty); first = preferred. */
  slots: Array<string | null>; oneRow: boolean;
  sort: { key: SortKey; dir: 1 | -1 }; move: Move; minMove: number; colorFilter: string;
};

/** Exchanges whose contracts, prices and charts the list supports today. */
export const MARKET_LIST_EXCHANGES = ['binance', 'bybit', 'okx', 'gate', 'bitget', 'mexc', 'bingx'];
/** Every exchange the site uses (home page), for the slot dropdowns; the rest are not chartable yet. */
const ALL_EXCHANGES = ['binance', 'bybit', 'okx', 'gate', 'bitget', 'mexc', 'kucoin', 'bingx', 'htx', 'kraken',
  'hyperliquid', 'aster', 'lighter', 'paradex', 'deribit', 'coinex', 'bitmex', 'toobit'];
const DEFAULT_SLOTS: Array<string | null> = [...MARKET_LIST_EXCHANGES, null, null, null];
const EXCHANGE_NAMES: Record<string, string> = {
  binance: 'Binance', bybit: 'Bybit', okx: 'OKX', gate: 'Gate.io', bitget: 'Bitget', mexc: 'MEXC', bingx: 'BingX',
  kucoin: 'KuCoin', htx: 'HTX', kraken: 'Kraken', hyperliquid: 'Hyperliquid', aster: 'Aster', lighter: 'Lighter',
  paradex: 'Paradex', deribit: 'Deribit', coinex: 'CoinEx', bitmex: 'BitMEX', toobit: 'Toobit',
};
export const HIGHLIGHT_COLORS = [
  { id: 'red', value: '#f23645' }, { id: 'orange', value: '#ff9800' }, { id: 'yellow', value: '#f5d33b' },
  { id: 'green', value: '#22ab94' }, { id: 'blue', value: '#2962ff' }, { id: 'purple', value: '#9c27b0' },
];
const COLOR_VALUE = Object.fromEntries(HIGHLIGHT_COLORS.map((color) => [color.id, color.value]));
const KEY = 'cof:v1:market-list';
const DEFAULTS: Prefs = {
  hidden: [], colors: {}, slots: DEFAULT_SLOTS, oneRow: true,
  sort: { key: 'volume', dir: -1 }, move: 'all', minMove: 0, colorFilter: 'all',
};
const ROW_HEIGHT = 38;

function normalizePrefs(saved: unknown): Prefs {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return DEFAULTS;
  const value = saved as Partial<Prefs> & { order?: unknown; exchanges?: unknown };
  return { ...DEFAULTS, ...value, sort: { ...DEFAULTS.sort, ...value.sort },
    hidden: Array.isArray(value.hidden) ? value.hidden.filter((item): item is string => typeof item === 'string') : [],
    colors: value.colors && typeof value.colors === 'object' ? value.colors : {},
    slots: normalizeSlots(value.slots, MARKET_LIST_EXCHANGES, DEFAULT_SLOTS, value) };
}
function readPrefs(): Prefs {
  try { return normalizePrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return DEFAULTS; }
}
/** Settings saved to the signed-in account (follow the user to any device). */
async function savePrefs(value: Prefs) {
  await fetch('/api/me/prefs/market-list', { method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
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
  /** One-row mode: same coin on lower-priority exchanges; secondary = shown under its main row. */
  others: MarketContract[]; secondary?: boolean;
};

export function MarketList({ contracts, current, onSelect }: {
  contracts: MarketContract[]; current: MarketContract | null; onSelect: (contract: MarketContract) => void;
}) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [query, setQuery] = useState('');
  const [palette, setPalette] = useState<string | null>(null);
  // The exchange priority list opens together with Filters; its own button can fold it.
  // Filters fold away so the list gets the space; remembered in this browser.
  const [showFilters, setShowFilters] = useState(() => { try { return localStorage.getItem(`${KEY}:filters-open`) === '1'; } catch { return false; } });
  const [showPriority, setShowPriority] = useState(showFilters);
  const toggleFilters = () => setShowFilters((open) => {
    try { localStorage.setItem(`${KEY}:filters-open`, open ? '0' : '1'); } catch { /* storage blocked */ }
    setShowPriority(!open);
    return !open;
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const listRef = useRef<HTMLDivElement>(null);
  const { user, loading: authLoading } = useAuth();
  // Account settings: loaded once after sign-in; changes are saved shortly after you make them.
  const synced = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const accountPrefs = useQuery({
    queryKey: ['me-prefs', 'market-list', user?.email],
    enabled: !!user,
    queryFn: async () => {
      const response = await fetch('/api/me/prefs/market-list', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Settings unavailable');
      return (await response.json()) as { value: unknown };
    },
    staleTime: Infinity, retry: 1,
  });
  useEffect(() => {
    if (!user) { synced.current = false; return; }
    if (!accountPrefs.isSuccess || synced.current) return;
    synced.current = true;
    if (accountPrefs.data.value) {
      const loaded = normalizePrefs(accountPrefs.data.value);
      setPrefs(loaded);
      try { localStorage.setItem(KEY, JSON.stringify(loaded)); } catch { /* storage blocked */ }
    } else {
      void savePrefs(prefs); // first sign-in: keep what this browser had
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, accountPrefs.isSuccess, accountPrefs.data]);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);
  // Sign-out resets the list to the defaults; the account's settings return on sign-in.
  useEffect(() => {
    const reset = () => { window.clearTimeout(saveTimer.current); synced.current = false; setPrefs(DEFAULTS); setExpanded(new Set()); setQuery(''); };
    window.addEventListener(SIGNED_OUT_EVENT, reset);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, reset);
  }, []);
  const update = (patch: Partial<Prefs>) => setPrefs((previous) => {
    const next = { ...previous, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
    if (synced.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => { void savePrefs(next); }, 700);
    }
    return next;
  });

  const tickers = useQuery({
    enabled: !!user,
    queryKey: ['market-tickers'],
    queryFn: async ({ signal }): Promise<TickersPayload> => {
      const response = await fetch('/api/market/tickers', { signal });
      if (!response.ok) throw new Error(response.status === 404 ? 'restart' : `HTTP ${response.status}`);
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

  const enabledOrder = useMemo(() => prefs.slots.filter((slot): slot is string => !!slot), [prefs.slots]);
  const rows = useMemo<Row[]>(() => {
    const hidden = new Set(prefs.hidden);
    const wanted = query.trim().toUpperCase();
    const isHidden = (contract: MarketContract) => hidden.has(`${contract.exchange.toLowerCase()}:${contract.symbol}`)
      || hidden.has(`coin:${contract.asset.toUpperCase()}`);
    const build = (contract: MarketContract, others: MarketContract[] = [], secondary = false): Row => {
      const key = `${contract.exchange.toLowerCase()}:${contract.symbol}`;
      const ticker = prices.get(key);
      const last = ticker?.[1] ?? null;
      const changePercent = ticker?.[2] ?? null;
      const change = last !== null && changePercent !== null ? last - last / (1 + changePercent / 100) : null;
      return { key, contract, last, change, changePercent, volume: ticker?.[3] ?? null, color: prefs.colors[key], others, secondary };
    };
    // One row per coin: from the first exchange in your priority order that lists it.
    const candidates: Row[] = prefs.oneRow
      ? groupByPriority(contracts, enabledOrder, enabledOrder, isHidden).map(({ primary, others }) => build(primary, others))
      : contracts.filter((contract) => enabledOrder.includes(contract.exchange.toLowerCase()) && !isHidden(contract)).map((contract) => build(contract));
    const list = candidates.filter((row) => {
      if (wanted && !row.contract.exchangeAsset.toUpperCase().includes(wanted) && !row.contract.asset.toUpperCase().includes(wanted)) return false;
      if (prefs.colorFilter !== 'all' && row.color !== prefs.colorFilter) return false;
      const move = row.changePercent;
      if (prefs.move === 'gainers' && !(move !== null && move > 0)) return false;
      if (prefs.move === 'losers' && !(move !== null && move < 0)) return false;
      if (prefs.minMove > 0 && !(move !== null && Math.abs(move) >= prefs.minMove)) return false;
      return true;
    });
    const { key: sortKey, dir } = prefs.sort;
    const value = (row: Row) => sortKey === 'last' ? row.last : sortKey === 'change' ? row.change
      : sortKey === 'changePercent' ? row.changePercent : sortKey === 'volume' ? row.volume : null;
    list.sort((a, b) => {
      if (sortKey === 'symbol') return dir * (a.contract.exchangeAsset.localeCompare(b.contract.exchangeAsset) || a.contract.exchange.localeCompare(b.contract.exchange));
      const left = value(a), right = value(b);
      if (left === null && right === null) return a.contract.exchangeAsset.localeCompare(b.contract.exchangeAsset);
      if (left === null) return 1;
      if (right === null) return -1;
      return dir * (left - right);
    });
    if (!prefs.oneRow || !expanded.size) return list;
    // "+N" opened: the coin's other exchanges listed under its main row.
    return list.flatMap((row) => expanded.has(row.contract.asset.toUpperCase())
      ? [row, ...row.others.map((other) => build(other, [], true))] : [row]);
  }, [contracts, prices, prefs, query, expanded, enabledOrder]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [user]);
  useEffect(() => {
    if (!palette) return;
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest?.('.market-list-palette, .market-list-flag')) setPalette(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [palette]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 6);
  const visible = rows.slice(first, first + Math.ceil(viewport / ROW_HEIGHT) + 12);
  const currentKey = current ? `${current.exchange.toLowerCase()}:${current.symbol}` : '';
  const total = prefs.oneRow ? new Set(contracts.map((contract) => contract.asset.toUpperCase())).size
    : contracts.filter((contract) => MARKET_LIST_EXCHANGES.includes(contract.exchange.toLowerCase())).length;
  const shown = rows.filter((row) => !row.secondary).length;
  const toggleExpanded = (coin: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(coin)) next.delete(coin); else next.add(coin);
    return next;
  });
  const filtered = prefs.hidden.length > 0 || prefs.move !== 'all'
    || prefs.minMove > 0 || prefs.colorFilter !== 'all';
  const activeFilters = [prefs.move !== 'all', prefs.minMove > 0, prefs.colorFilter !== 'all', prefs.hidden.length > 0, !prefs.oneRow].filter(Boolean).length;
  const sortBy = (key: SortKey) => update({ sort: { key, dir: prefs.sort.key === key ? (prefs.sort.dir === 1 ? -1 : 1) : key === 'symbol' ? 1 : -1 } });
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
    .filter(([exchange, entry]) => enabledOrder.includes(exchange) && entry.status === 'unavailable').map(([exchange]) => EXCHANGE_NAMES[exchange] ?? exchange);

  if (authLoading || !user) {
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    return (
      <aside className="market-list market-list-locked" aria-label="Market list" data-testid="market-list">
        <header className="market-list-head">
          <div>
            <div className="market-list-eyebrow">USDT perpetuals · 24h</div>
            <h2>Markets</h2>
          </div>
        </header>
        {authLoading ? <p className="market-list-empty" role="status">Checking your account…</p> : (
          <div className="market-list-gate" data-testid="market-list-locked">
            <span className="market-list-gate-icon" aria-hidden="true"><Lock size={18} /></span>
            <strong>Your market list</strong>
            <p>Every coin across the exchanges with live price and 24h change: sort, filter, colour and set your exchange priority.
              Saved to your account on any device. New here? You can create a free account on the next screen.</p>
            <Link href={`/signin?next=${next}`} className="market-list-signin" data-testid="market-list-signin">
              <LogIn size={14} aria-hidden="true" /> Sign in</Link>
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className="market-list" aria-label="Market list" data-testid="market-list">
      <header className="market-list-head">
        <div>
          <div className="market-list-eyebrow">USDT perpetuals · 24h</div>
          <h2>Markets <span>{shown.toLocaleString()}{shown !== total ? ` / ${total.toLocaleString()}` : ''} {prefs.oneRow ? 'coins' : 'contracts'}</span></h2>
        </div>
        <button type="button" className="market-list-reset" onClick={() => { update({ ...DEFAULTS, colors: prefs.colors, slots: prefs.slots, oneRow: prefs.oneRow }); setQuery(''); setExpanded(new Set()); }}
          disabled={!filtered && !query} title="Show every coin on every exchange again (keeps your colours and exchange priority)" data-testid="market-reset">
          <RotateCcw size={12} aria-hidden="true" /> Reset
        </button>
      </header>
      <div className="market-list-tools">
        <div className="market-list-searchrow">
          <label className="market-list-search"><Search size={13} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search coin" aria-label="Search coins"
              spellCheck={false} autoCapitalize="characters" data-testid="market-search" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={12} /></button>}
          </label>
          <button type="button" className={`market-list-filters-toggle${activeFilters ? ' has-active' : ''}`} aria-expanded={showFilters}
            onClick={toggleFilters} title={showFilters ? 'Hide filters' : 'Show filters and exchange priority'} data-testid="market-filters-toggle">
            <SlidersHorizontal size={12} aria-hidden="true" /> Filters{activeFilters ? <b>{activeFilters}</b> : null}
            <ChevronDown size={12} aria-hidden="true" className="market-list-chevron" />
          </button>
        </div>
        {showFilters && <>
        <div className="market-list-mode">
          <label className="market-list-onerow" title="Show each coin once, from your highest-priority exchange that lists it">
            <input type="checkbox" checked={prefs.oneRow} onChange={(event) => { update({ oneRow: event.target.checked }); setExpanded(new Set()); }}
              data-testid="market-one-row" /> One row per coin
          </label>
          <button type="button" className="market-list-priority-toggle" aria-expanded={showPriority} onClick={() => setShowPriority(!showPriority)}
            data-testid="market-priority-toggle" title="Exchange priority and which exchanges to include">
            <span className="market-list-priority-summary">{enabledOrder.slice(0, 3).map((exchange) => EXCHANGE_NAMES[exchange]).join(' › ')}
              {enabledOrder.length > 3 ? ` +${enabledOrder.length - 3}` : ''}{!enabledOrder.length ? 'No exchanges' : ''}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </div>
        {showPriority && (
          <ol className="market-list-priority" aria-label="Exchange priority" data-testid="market-priority">
            {prefs.slots.map((exchange, index) => (
              <li key={index} className={exchange ? '' : 'is-empty'} data-testid={`market-slot-${index + 1}`}>
                <span className="market-list-rank">{index + 1}</span>
                <span className="market-list-slot">
                  {exchange ? <ExchangeLogo exchange={exchange} /> : <span className="market-list-slot-blank" aria-hidden="true" />}
                  <select value={exchange ?? ''} aria-label={`Priority ${index + 1} exchange`} data-testid={`market-slot-select-${index + 1}`}
                    onChange={(event) => update({ slots: assignSlot(prefs.slots, index, event.target.value || null) })}>
                    <option value="">— Empty —</option>
                    {ALL_EXCHANGES.map((option) => {
                      const supported = MARKET_LIST_EXCHANGES.includes(option);
                      const at = prefs.slots.indexOf(option);
                      return <option key={option} value={option} disabled={!supported}>
                        {EXCHANGE_NAMES[option]}{!supported ? ' (soon)' : at >= 0 && at !== index ? ` (#${at + 1})` : ''}</option>;
                    })}
                  </select>
                </span>
                <button type="button" onClick={() => update({ slots: moveSlot(prefs.slots, index, -1) })} disabled={index === 0}
                  aria-label={`Move priority ${index + 1} up`} data-testid={`market-up-${index + 1}`}><ChevronUp size={13} /></button>
                <button type="button" onClick={() => update({ slots: moveSlot(prefs.slots, index, 1) })} disabled={index === prefs.slots.length - 1}
                  aria-label={`Move priority ${index + 1} down`} data-testid={`market-down-${index + 1}`}><ChevronDown size={13} /></button>
              </li>
            ))}
            <li className="market-list-priority-actions">
              <button type="button" onClick={() => update({ slots: DEFAULT_SLOTS })} data-testid="market-slots-default">Default exchanges</button>
            </li>
            <li className="market-list-priority-note">{prefs.oneRow
              ? 'Each coin comes from the first exchange above that lists it; coins it lacks come from the next one. Pick an exchange per slot, leave slots empty to skip them. Exchanges marked (soon) are not chartable yet.'
              : 'One row per coin is off: every exchange’s contract is listed.'}</li>
          </ol>
        )}
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
        </>}
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
              <div key={row.key} role="listitem" className={`market-list-row${row.key === currentKey ? ' is-current' : ''}${color ? ' is-colored' : ''}${row.secondary ? ' is-secondary' : ''}`}
                style={{ top: (first + index) * ROW_HEIGHT, ...(color ? { '--row-color': color } as React.CSSProperties : {}) }}
                data-testid={`market-row-${row.key}`}>
                <button type="button" className="market-list-flag" style={color ? { background: color } : undefined}
                  onClick={() => setPalette(palette === row.key ? null : row.key)} aria-label={`Colour ${row.contract.exchangeAsset} on ${EXCHANGE_NAMES[row.contract.exchange] ?? row.contract.exchange}`}
                  title="Colour this row" />
                <button type="button" className="market-list-select" onClick={() => onSelect(row.contract)}
                  aria-current={row.key === currentKey ? 'true' : undefined} title={`${row.contract.exchangeAsset}USDT · ${EXCHANGE_NAMES[row.contract.exchange] ?? row.contract.exchange}`}>
                  <span className="market-list-symbol"><CoinLogo asset={row.contract.asset} />
                    <span className="market-list-name"><b>{row.contract.exchangeAsset}</b><small><ExchangeLogo exchange={row.contract.exchange} />{EXCHANGE_NAMES[row.contract.exchange] ?? row.contract.exchange}</small></span>
                    {row.others.length > 0 && <span role="button" tabIndex={0} className={`market-list-more${expanded.has(row.contract.asset.toUpperCase()) ? ' is-open' : ''}`}
                      title={`Also on ${row.others.map((other) => EXCHANGE_NAMES[other.exchange] ?? other.exchange).join(', ')}`}
                      onClick={(event) => { event.stopPropagation(); toggleExpanded(row.contract.asset.toUpperCase()); }}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggleExpanded(row.contract.asset.toUpperCase()); } }}
                      data-testid={`market-more-${row.contract.asset}`}>+{row.others.length}</span>}</span>
                  <span className="market-list-num">{row.last === null ? '—' : formatPrice(row.last)}</span>
                  <span className={`market-list-num${tone}`}>{row.change === null ? '—' : signed(formatPrice(row.change, row.last ?? row.change), row.change)}</span>
                  <span className={`market-list-num${tone}`}>{row.changePercent === null ? '—' : `${signed(row.changePercent.toFixed(2), row.changePercent)}%`}</span>
                </button>
                {!row.secondary && <button type="button" className="market-list-hide"
                  onClick={() => update({ hidden: [...prefs.hidden, prefs.oneRow ? `coin:${row.contract.asset.toUpperCase()}` : row.key] })}
                  aria-label={`Remove ${row.contract.exchangeAsset} on ${EXCHANGE_NAMES[row.contract.exchange] ?? row.contract.exchange} from the list`} title="Remove from list (Reset brings it back)"
                  data-testid={`market-hide-${row.key}`}><X size={12} aria-hidden="true" /></button>}
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
        {tickers.isError ? (tickers.error?.message === 'restart'
          ? 'Prices unavailable: the server is running an older version. Restart it after updating.'
          : 'Prices unavailable right now; retrying.') : unavailable.length ? `No prices from ${unavailable.join(', ')} right now.`
          : `Click a coin to chart it · ● colour · × remove · +N other exchanges · saved to your account.`}
      </footer>
    </aside>
  );
}
