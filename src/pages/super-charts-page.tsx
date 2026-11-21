import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, RotateCw } from 'lucide-react';
import { Link } from 'wouter';
import { AppHeader } from '@/components/app-header';
import { MarketList } from '@/components/market-list';
import { DEFAULT_LAYOUT_SYNC, LayoutPicker, type LayoutSync } from '@/components/layout-picker';
import { CELL_AREAS, CHART_LAYOUTS, gridStyle, layoutById } from '@/lib/chart-layouts';
import { MarketAutocomplete, type AutocompleteOption } from '@/components/market-autocomplete';
import { NativeChartWorkspace } from '@/components/native-chart-workspace';
import { useMarketContracts, type MarketContract } from '@/hooks/use-market-contracts';
import { CHART_STUDIES, CHART_STUDY_GROUPS, type ChartStudyId } from '@/lib/supercharts';
import { useChartSetting } from '@/hooks/use-chart-setting';
import { useChartSettingsSync } from '@/hooks/use-chart-settings-sync';
import { useAuth } from '@/hooks/use-auth';
import { SuperChartsGate } from '@/components/super-charts-gate';
import { LAST_CHART_CONTRACT_KEY, readChartPreference, writeChartPreference, validChartContract } from '@/lib/chart-preferences.js';
import '@/styles/super-charts.css';
import { useCoinMemory } from '@/hooks/use-coin-memory';

type MenuId = 'technical' | 'orderflow' | null;
type OrderflowId = 'liquidity' | 'funding' | 'perpetual-cvd' | 'spot-cvd' | 'aggressive-bubbles' | 'volume-profile' | 'oi-driver' | 'leverage' | 'global-lsar' | 'top-lsar';
const ORDERFLOW_ITEMS: Array<{ id: OrderflowId; label: string }> = [
  { id: 'liquidity', label: 'Liquidity Zones' },
  { id: 'funding', label: 'Aggregated Funding Rate' },
  { id: 'perpetual-cvd', label: 'Aggregated Perpetual CVD' },
  { id: 'spot-cvd', label: 'Aggregated Spot CVD' },
  { id: 'aggressive-bubbles', label: 'Aggressive Volume Bubbles' },
  { id: 'volume-profile', label: 'Session Volume Profile' },
  { id: 'oi-driver', label: 'Aggregated Open Interest' },
  { id: 'leverage', label: 'Perp Leverage Estimation' },
  { id: 'global-lsar', label: 'Global Long Short Account Ratio' },
  { id: 'top-lsar', label: 'Top Trader Long Short Account Ratio' },
];
const ALLOWED_EXCHANGES = new Set(['binance', 'gate', 'okx', 'bybit', 'mexc', 'bitget', 'bingx', 'aster', 'hyperliquid', 'kucoin', 'htx']);

/** Super Charts needs a (free) account: signed-out visitors get the sign-in screen. */
export function SuperChartsPage() {
  const { user, loading } = useAuth();
  if (loading) return <div className="terminal module-app"><main className="sc-gate-main" aria-busy="true" /></div>;
  return user ? <SuperChartsWorkspace /> : <SuperChartsGate />;
}

function SuperChartsWorkspace() {
  const [menu, setMenu] = useState<MenuId>(null);
  useChartSettingsSync();
  const [market, setMarket] = useState<MarketContract | null>(null);
  const [studies, setStudies] = useChartSetting<ChartStudyId[]>('studies', ['rsi'],
    value => Array.isArray(value) && value.every(id => CHART_STUDIES.some(study => study.id === id)));
  const [indicators, setIndicators] = useChartSetting<OrderflowId[]>('indicators', ['liquidity'],
    value => Array.isArray(value) && value.every(id => ORDERFLOW_ITEMS.some(item => item.id === id)));
  // Charts 2–4 of a layout keep their own indicator lists (chart 1 uses the two
  // settings above). A window without its own list starts from chart 1's.
  type CellLayers = { studies: ChartStudyId[]; indicators: OrderflowId[] };
  const [cellLayers, setCellLayers] = useChartSetting<Record<string, CellLayers>>('cellLayers', {},
    value => !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value as Record<string, CellLayers>).every(entry =>
      Array.isArray(entry?.studies) && entry.studies.every(id => CHART_STUDIES.some(study => study.id === id)) &&
      Array.isArray(entry?.indicators) && entry.indicators.every(id => ORDERFLOW_ITEMS.some(item => item.id === id))));
  const cellStudies = (index: number) => index === 0 ? studies : cellLayers[index]?.studies ?? studies;
  const cellIndicators = (index: number) => index === 0 ? indicators : cellLayers[index]?.indicators ?? indicators;
  const [marketDraft, setMarketDraft] = useState('');
  const [studyQuery, setStudyQuery] = useState('');
  const studyMatches = (label: string) => !studyQuery.trim() || label.toLowerCase().includes(studyQuery.trim().toLowerCase());
  // Super Charts always opens as the big chart: one toolbar, the chart and the
  // market list fill the browser window (the computer's taskbar stays visible).
  const expanded = true;
  useEffect(() => {
    if (!expanded) return;
    document.body.classList.add('chart-fullscreen-open');
    // Chart fills the space left under the menus (they can wrap; the chart remounts on TF change).
    const fit = () => {
      // Every chart fills the space left in its cell under its toolbar.
      document.querySelectorAll<HTMLElement>('.is-chart-expanded .native-chart-canvas').forEach((canvas) => {
        const cell = canvas.closest('.sc-cell');
        const bottom = cell ? cell.getBoundingClientRect().bottom - 4 : window.innerHeight - 12;
        const height = `${Math.max(140, Math.floor(bottom - canvas.getBoundingClientRect().top))}px`;
        if (canvas.style.height !== height) canvas.style.height = height;
      });
    };
    const timer = window.setInterval(fit, 400);
    window.addEventListener('resize', fit);
    requestAnimationFrame(fit);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', fit);
      document.querySelectorAll<HTMLElement>('.native-chart-canvas').forEach((canvas) => { canvas.style.height = ''; });
      document.body.classList.remove('chart-fullscreen-open');
    };
  }, [expanded]);
  const memory = useCoinMemory('super-charts');
  const { remember } = memory;
  useEffect(() => { if (market?.asset) remember(market.asset); }, [market?.asset, remember]);
  const menuRef = useRef<HTMLDivElement>(null);
  const catalogue = useMarketContracts();
  const contracts = useMemo(
    () => (catalogue.data?.contracts ?? []).filter((contract) => ALLOWED_EXCHANGES.has(contract.exchange.toLowerCase())),
    [catalogue.data],
  );
  const options = useMemo<AutocompleteOption[]>(() => contracts.map((contract) => ({
    value: contract.label,
    label: contract.label,
    detail: contract.asset === contract.exchangeAsset ? contract.asset : `${contract.asset} · ${contract.exchangeAsset}`,
  })), [contracts]);

  useEffect(() => {
    if (market || !contracts.length) return;
    const saved = readChartPreference(LAST_CHART_CONTRACT_KEY, null, validChartContract);
    const preferred = saved ? contracts.find(contract =>
      contract.asset === saved.asset && contract.exchange === saved.exchange && contract.symbol === saved.symbol) : null;
    // Don't replace a saved selection with BTC while its catalogue is still loading.
    if (saved && !preferred && catalogue.data?.sources.some(source =>
      source.exchange === saved.exchange && source.status === 'loading')) return;
    const bitcoin = contracts.find((contract) => contract.exchange.toLowerCase() === 'binance' && contract.asset.toUpperCase() === 'BTC')
      ?? contracts.find((contract) => contract.asset.toUpperCase() === 'BTC');
    const catalogueStillLoading = catalogue.data?.sources.some((source) => source.status === 'loading') ?? false;
    if (!bitcoin && catalogueStillLoading) return;
    const initial = preferred ?? bitcoin ?? contracts[0];
    setMarket(initial);
    setMarketDraft(initial.label);
    writeChartPreference(LAST_CHART_CONTRACT_KEY, {
      asset: initial.asset, exchange: initial.exchange, symbol: initial.symbol,
    });
  }, [contracts, market, catalogue.data]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  const selectMarket = (value: string) => {
    setMarketDraft(value);
    const selected = contracts.find((contract) => contract.label === value);
    if (selected) selectWatchlistContract(selected);
  };
  // Multi-chart layout: chart 1 is `market`; charts 2–4 are saved as exchange + symbol.
  const [layoutId, setLayoutId] = useChartSetting<string>('layout', '1', (value) => CHART_LAYOUTS.some((layout) => layout.id === value));
  const [cellKeys, setCellKeys] = useChartSetting<Array<{ exchange: string; symbol: string } | null>>('cellContracts', [],
    (value) => Array.isArray(value));
  const [activeCell, setActiveCell] = useState(0);
  const [layoutSync, setLayoutSync] = useChartSetting<LayoutSync>('layoutSync', DEFAULT_LAYOUT_SYNC,
    (value) => !!value && typeof value === 'object' && Object.keys(DEFAULT_LAYOUT_SYNC).every((key) => typeof (value as Record<string, unknown>)[key] === 'boolean'));
  const layout = layoutById(layoutId);
  const cellContract = (index: number): MarketContract | null => {
    if (index === 0 || layoutSync.symbol) return market; // Symbol sync: every chart shows the same coin
    const saved = cellKeys[index];
    const found = saved && contracts.find((contract) => contract.exchange === saved.exchange && contract.symbol === saved.symbol);
    if (found) return found;
    // Until chosen, extra charts show other major coins on Binance.
    const fallback = ['ETH', 'SOL', 'XRP'][index - 1];
    return contracts.find((contract) => contract.exchange.toLowerCase() === 'binance' && contract.asset === fallback) ?? contracts[index] ?? null;
  };
  const selectWatchlistContract = (contract: MarketContract) => {
    if (activeCell > 0 && activeCell < layout.count && !layoutSync.symbol) {
      setCellKeys((current) => { const next = [...current]; next[activeCell] = { exchange: contract.exchange, symbol: contract.symbol }; return next; });
      setMarketDraft(contract.label);
      return;
    }
    setMarket(contract);
    setMarketDraft(contract.label);
    writeChartPreference(LAST_CHART_CONTRACT_KEY, {
      asset: contract.asset, exchange: contract.exchange, symbol: contract.symbol,
    });
  };
  const toggled = <T,>(list: T[], id: T) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  // Adding/removing an indicator only changes the chart window it was done in.
  const toggleStudy = (id: ChartStudyId, index = activeCell) => {
    if (index === 0) { setStudies((current) => toggled(current, id)); return; }
    setCellLayers((current) => ({ ...current, [index]: { studies: toggled(current[index]?.studies ?? studies, id), indicators: current[index]?.indicators ?? indicators } }));
  };
  const toggleIndicator = (id: OrderflowId, index = activeCell) => {
    if (index === 0) { setIndicators((current) => toggled(current, id)); return; }
    setCellLayers((current) => ({ ...current, [index]: { studies: current[index]?.studies ?? studies, indicators: toggled(current[index]?.indicators ?? indicators, id) } }));
  };

  return (
    <div className="terminal module-app super-charts-app">
      <AppHeader title="Super Charts" mark="SC" sectionLabel="Super Charts (Indicators)" subtitle="Perpetual Markets" />
      <main className={`super-charts-main${expanded ? ' is-chart-expanded' : ''}`}>
        {/* Catalogue problems only; everything else lives in the chart toolbar. */}
        <div className="super-chart-catalogue-status">
          {(catalogue.error || !catalogue.loading && contracts.length === 0) && (
            <div className="super-chart-catalogue-alert" role="status">
              <span>{catalogue.error ?? 'No live contracts are currently listed.'}</span>
              <button type="button" onClick={catalogue.refresh}><RotateCw size={13} aria-hidden="true" /> Retry</button>
            </div>
          )}
          {!catalogue.error && catalogue.data?.sources.some((source) => source.status === 'loading') && (
            <span className="super-chart-catalogue-loading" role="status">Contract sources are still loading</span>
          )}
          {!catalogue.error && contracts.length > 0 && catalogue.data?.sources.some((source) => source.status === 'unavailable') && (
            <div className="super-chart-catalogue-alert" role="status">
              <span>Some contract sources are unavailable; listings may be partial.</span>
              <button type="button" onClick={catalogue.refresh}><RotateCw size={13} aria-hidden="true" /> Retry catalogue</button>
            </div>
          )}
        </div>
        <div className="super-chart-workspace-layout has-market-list">
          {/* One to four charts; click a chart to make it the one the toolbar and market list change. */}
          <div className={`super-chart-workspace-main sc-cells${layout.count > 1 ? ' is-multi' : ''}`} style={gridStyle(layout)} data-testid="chart-cells">
            {CELL_AREAS.slice(0, layout.count).map((area, index) => (
              <div key={area} className={`sc-cell${index === activeCell ? ' is-active' : ''}`} style={{ gridArea: area }}
                onPointerDownCapture={() => { if (index !== activeCell) { setActiveCell(index); const contract = cellContract(index); if (contract) setMarketDraft(contract.label); } }}
                data-testid={`chart-cell-${index}`}>
              <NativeChartWorkspace contract={cellContract(index)} studies={cellStudies(index)} indicators={cellIndicators(index)}
                cellId={layoutSync.interval ? 0 : index} syncId={index}
                sync={layout.count > 1 ? { crosshair: layoutSync.crosshair, time: layoutSync.time, range: layoutSync.range } : undefined}
                toolbarStart={index !== activeCell ? undefined : <div className="sc-symbol">
                  <Link href="/" className="sc-home" aria-label="Crypto Order Flow home" title="Home">CO</Link>
                  <MarketAutocomplete value={marketDraft} onChange={selectMarket} options={options}
                    label="Search perpetual contracts" placeholder={catalogue.loading ? 'Loading…' : 'Symbol search'}
                    className="super-chart-contract-combo sc-symbol-search" inputClassName="super-chart-contract-input"
                    autoCapitalize="characters" disabled={catalogue.loading && !catalogue.data} />
                  <LayoutPicker value={layout.id} onChange={(id) => { setLayoutId(id); if (activeCell >= layoutById(id).count) setActiveCell(0); }}
                  sync={layoutSync} onSyncChange={setLayoutSync} />
                </div>}
                toolbarMenus={index !== activeCell ? undefined : 
            <div className="super-chart-menu-bar" ref={menuRef}>
              <div className="super-chart-dropdown">
                <button type="button" className="super-chart-menu-trigger" aria-haspopup="true" aria-expanded={menu === 'technical'}
                  onClick={() => setMenu((current) => current === 'technical' ? null : 'technical')}>
                  Technical Indicators <span className="super-chart-selection-count">{cellStudies(index).length}</span><ChevronDown size={14} aria-hidden="true" />
                </button>
                {menu === 'technical' && <div className="super-chart-menu is-studies" role="group" aria-label="Technical indicators">
                  <input className="super-chart-menu-search" type="search" placeholder={`Search ${CHART_STUDIES.length} indicators…`} autoFocus
                    value={studyQuery} onChange={(event) => setStudyQuery(event.target.value)} aria-label="Search technical indicators" data-testid="study-search" />
                  {CHART_STUDY_GROUPS.filter((group) => CHART_STUDIES.some((study) => study.group === group && studyMatches(study.label))).map((group) => (
                    <div key={group} role="group" aria-label={group}>
                      <div className="super-chart-menu-group">{group}</div>
                      {CHART_STUDIES.filter((study) => study.group === group && studyMatches(study.label)).map((study) => (
                        <button type="button" key={study.id} className={cellStudies(index).includes(study.id) ? 'is-selected' : ''}
                          aria-pressed={cellStudies(index).includes(study.id)} onClick={() => toggleStudy(study.id)} data-testid={`study-${study.id}`}>
                          <span className="super-chart-menu-check">{cellStudies(index).includes(study.id) && <Check size={12} aria-hidden="true" />}</span>{study.label}
                        </button>
                      ))}
                    </div>
                  ))}
                  {!CHART_STUDIES.some((study) => studyMatches(study.label)) && <p>No indicator matches “{studyQuery}”.</p>}
                  <p>Native studies · standard default settings · shared price time axis</p>
                </div>}
              </div>
              <div className="super-chart-dropdown">
                <button type="button" className="super-chart-menu-trigger" aria-haspopup="true" aria-expanded={menu === 'orderflow'}
                  onClick={() => setMenu((current) => current === 'orderflow' ? null : 'orderflow')}>
                  Orderflow Indicators <span className="super-chart-selection-count">{cellIndicators(index).length}</span><ChevronDown size={14} aria-hidden="true" />
                </button>
                {menu === 'orderflow' && <div className="super-chart-menu" role="group" aria-label="Orderflow indicators">
                  {ORDERFLOW_ITEMS.map((item) => (
                    <button type="button" key={item.id} className={cellIndicators(index).includes(item.id) ? 'is-selected' : ''}
                      aria-pressed={cellIndicators(index).includes(item.id)} onClick={() => toggleIndicator(item.id)}>
                      <span className="super-chart-menu-check">{cellIndicators(index).includes(item.id) && <Check size={12} aria-hidden="true" />}</span>{item.label}
                    </button>
                  ))}
                  <p>Venue-derived signals, aligned to the same chart</p>
                </div>}
              </div>
            </div>
                }
                onRemoveLayer={(key) => {
                  if (CHART_STUDIES.some((study) => study.id === key)) toggleStudy(key as ChartStudyId, index);
                  else if (ORDERFLOW_ITEMS.some((item) => item.id === key)) toggleIndicator(key as OrderflowId, index);
                }} />
              </div>
            ))}
          </div>
          {/* Exchange-style list of every contract. */}
          <MarketList contracts={contracts} current={cellContract(activeCell)} onSelect={selectWatchlistContract} />
        </div>
      </main>
    </div>
  );
}
