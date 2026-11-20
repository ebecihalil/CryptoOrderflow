import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, RotateCw } from 'lucide-react';
import { Link } from 'wouter';
import { AppHeader } from '@/components/app-header';
import { MarketList } from '@/components/market-list';
import { LayoutPicker } from '@/components/layout-picker';
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
type OrderflowId = 'liquidity' | 'funding' | 'perpetual-cvd' | 'spot-cvd' | 'aggressive-bubbles' | 'oi-driver' | 'leverage' | 'global-lsar' | 'top-lsar';
const ORDERFLOW_ITEMS: Array<{ id: OrderflowId; label: string }> = [
  { id: 'liquidity', label: 'Liquidity Zones' },
  { id: 'funding', label: 'Aggregated Funding Rate' },
  { id: 'perpetual-cvd', label: 'Aggregated Perpetual CVD' },
  { id: 'spot-cvd', label: 'Aggregated Spot CVD' },
  { id: 'aggressive-bubbles', label: 'Aggressive Volume Bubbles' },
  { id: 'oi-driver', label: 'Aggregated Open Interest' },
  { id: 'leverage', label: 'Perp Leverage Estimation' },
  { id: 'global-lsar', label: 'Global Long Short Account Ratio' },
  { id: 'top-lsar', label: 'Top Trader Long Short Account Ratio' },
];
const ALLOWED_EXCHANGES = new Set(['binance', 'gate', 'okx', 'bybit', 'mexc', 'bitget', 'bingx']);

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
  const [marketDraft, setMarketDraft] = useState('');
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
  const layout = layoutById(layoutId);
  const cellContract = (index: number): MarketContract | null => {
    if (index === 0) return market;
    const saved = cellKeys[index];
    const found = saved && contracts.find((contract) => contract.exchange === saved.exchange && contract.symbol === saved.symbol);
    if (found) return found;
    // Until chosen, extra charts show other major coins on Binance.
    const fallback = ['ETH', 'SOL', 'XRP'][index - 1];
    return contracts.find((contract) => contract.exchange.toLowerCase() === 'binance' && contract.asset === fallback) ?? contracts[index] ?? null;
  };
  const selectWatchlistContract = (contract: MarketContract) => {
    if (activeCell > 0 && activeCell < layout.count) {
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
  const toggleStudy = (id: ChartStudyId) => setStudies((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleIndicator = (id: OrderflowId) => setIndicators((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

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
              <NativeChartWorkspace contract={cellContract(index)} studies={studies} indicators={indicators} cellId={index}
                toolbarStart={index !== activeCell ? undefined : <div className="sc-symbol">
                  <Link href="/" className="sc-home" aria-label="Crypto Order Flow home" title="Home">CO</Link>
                  <MarketAutocomplete value={marketDraft} onChange={selectMarket} options={options}
                    label="Search perpetual contracts" placeholder={catalogue.loading ? 'Loading…' : 'Symbol search'}
                    className="super-chart-contract-combo sc-symbol-search" inputClassName="super-chart-contract-input"
                    autoCapitalize="characters" disabled={catalogue.loading && !catalogue.data} />
                  <LayoutPicker value={layout.id} onChange={(id) => { setLayoutId(id); if (activeCell >= layoutById(id).count) setActiveCell(0); }} />
                </div>}
                toolbarMenus={index !== activeCell ? undefined : 
            <div className="super-chart-menu-bar" ref={menuRef}>
              <div className="super-chart-dropdown">
                <button type="button" className="super-chart-menu-trigger" aria-haspopup="true" aria-expanded={menu === 'technical'}
                  onClick={() => setMenu((current) => current === 'technical' ? null : 'technical')}>
                  Technical Indicators <span className="super-chart-selection-count">{studies.length}</span><ChevronDown size={14} aria-hidden="true" />
                </button>
                {menu === 'technical' && <div className="super-chart-menu is-studies" role="group" aria-label="Technical indicators">
                  {CHART_STUDY_GROUPS.map((group) => (
                    <div key={group} role="group" aria-label={group}>
                      <div className="super-chart-menu-group">{group}</div>
                      {CHART_STUDIES.filter((study) => study.group === group).map((study) => (
                        <button type="button" key={study.id} className={studies.includes(study.id) ? 'is-selected' : ''}
                          aria-pressed={studies.includes(study.id)} onClick={() => toggleStudy(study.id)} data-testid={`study-${study.id}`}>
                          <span className="super-chart-menu-check">{studies.includes(study.id) && <Check size={12} aria-hidden="true" />}</span>{study.label}
                        </button>
                      ))}
                    </div>
                  ))}
                  <p>Native studies · standard default settings · shared price time axis</p>
                </div>}
              </div>
              <div className="super-chart-dropdown">
                <button type="button" className="super-chart-menu-trigger" aria-haspopup="true" aria-expanded={menu === 'orderflow'}
                  onClick={() => setMenu((current) => current === 'orderflow' ? null : 'orderflow')}>
                  Orderflow Indicators <span className="super-chart-selection-count">{indicators.length}</span><ChevronDown size={14} aria-hidden="true" />
                </button>
                {menu === 'orderflow' && <div className="super-chart-menu" role="group" aria-label="Orderflow indicators">
                  {ORDERFLOW_ITEMS.map((item) => (
                    <button type="button" key={item.id} className={indicators.includes(item.id) ? 'is-selected' : ''}
                      aria-pressed={indicators.includes(item.id)} onClick={() => toggleIndicator(item.id)}>
                      <span className="super-chart-menu-check">{indicators.includes(item.id) && <Check size={12} aria-hidden="true" />}</span>{item.label}
                    </button>
                  ))}
                  <p>Venue-derived signals, aligned to the same chart</p>
                </div>}
              </div>
            </div>
                }
                onRemoveLayer={(key) => {
                  if (CHART_STUDIES.some((study) => study.id === key)) toggleStudy(key as ChartStudyId);
                  else if (ORDERFLOW_ITEMS.some((item) => item.id === key)) toggleIndicator(key as OrderflowId);
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
