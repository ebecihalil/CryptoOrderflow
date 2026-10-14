import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, RotateCw, X } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { ChartWatchlist } from '@/components/chart-watchlist';
import { MarketAutocomplete, type AutocompleteOption } from '@/components/market-autocomplete';
import { NativeChartWorkspace } from '@/components/native-chart-workspace';
import { useMarketContracts, type MarketContract } from '@/hooks/use-market-contracts';
import { CHART_STUDIES, type ChartStudyId } from '@/lib/supercharts';
import { useCoinChartSetting } from '@/hooks/use-coin-chart-setting';
import { LAST_CHART_CONTRACT_KEY, readChartPreference, writeChartPreference, validChartContract } from '@/lib/chart-preferences.js';
import '@/styles/super-charts.css';

type MenuId = 'technical' | 'orderflow' | null;
type OrderflowId = 'liquidity' | 'funding' | 'perpetual-cvd' | 'spot-cvd' | 'aggressive-bubbles';
const ORDERFLOW_ITEMS: Array<{ id: OrderflowId; label: string }> = [
  { id: 'liquidity', label: 'Liquidity Zones' },
  { id: 'funding', label: 'Aggregated Funding Rate' },
  { id: 'perpetual-cvd', label: 'Aggregated Perpetual CVD' },
  { id: 'spot-cvd', label: 'Aggregated Spot CVD' },
  { id: 'aggressive-bubbles', label: 'Aggressive Volume Bubbles' },
];
const ALLOWED_EXCHANGES = new Set(['binance', 'gate', 'okx', 'bybit', 'mexc', 'bitget', 'bingx']);

export function SuperChartsPage() {
  const [menu, setMenu] = useState<MenuId>(null);
  const [market, setMarket] = useState<MarketContract | null>(null);
  const [studies, setStudies] = useCoinChartSetting<ChartStudyId[]>(market?.asset ?? '', 'studies', ['rsi'],
    value => Array.isArray(value) && value.every(id => CHART_STUDIES.some(study => study.id === id)));
  const [indicators, setIndicators] = useCoinChartSetting<OrderflowId[]>(market?.asset ?? '', 'indicators', ['liquidity'],
    value => Array.isArray(value) && value.every(id => ORDERFLOW_ITEMS.some(item => item.id === id)));
  const [marketDraft, setMarketDraft] = useState('');
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
  const selectWatchlistContract = (contract: MarketContract) => {
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
      <main className="super-charts-main">
        <div className="super-charts-heading">
          <div className="module-kicker"><span className="module-kicker-rule" /> MARKET TOOLKIT / CHARTING</div>
          <h1 className="module-page-title">Super Charts</h1>
          <p>One exchange-fed view for price, crowd carry and confirmed liquidity structure.</p>
        </div>

        <section className="super-chart-marketbar" aria-label="Chart market selection">
          <div className="super-chart-market-copy">
            <span className="super-chart-market-kicker">ACTIVE CONTRACT</span>
            <strong>{market?.asset ?? 'Select a contract'}</strong>
            <small>{market ? `${market.exchange.toUpperCase()} native · ${market.symbol}` : 'Choose from the live catalogue'}</small>
          </div>
          <label className="super-chart-contract-field">
            <span>Perpetual contract</span>
            <MarketAutocomplete value={marketDraft} onChange={selectMarket} options={options}
              label="Search perpetual contracts" placeholder={catalogue.loading ? 'Loading contract catalogue…' : 'Search contract or asset'}
              className="super-chart-contract-combo" inputClassName="super-chart-contract-input"
              autoCapitalize="characters" disabled={catalogue.loading && !catalogue.data} />
          </label>
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
        </section>

        <div className="super-chart-menu-bar" ref={menuRef}>
          <div className="super-chart-dropdown">
            <button type="button" className="super-chart-menu-trigger" aria-haspopup="true" aria-expanded={menu === 'technical'}
              onClick={() => setMenu((current) => current === 'technical' ? null : 'technical')}>
              Technical Indicators <span className="super-chart-selection-count">{studies.length}</span><ChevronDown size={14} aria-hidden="true" />
            </button>
            {menu === 'technical' && <div className="super-chart-menu" role="group" aria-label="Technical indicators">
              {CHART_STUDIES.map((study) => (
                <button type="button" key={study.id} className={studies.includes(study.id) ? 'is-selected' : ''}
                  aria-pressed={studies.includes(study.id)} onClick={() => toggleStudy(study.id)}>
                  <span className="super-chart-menu-check">{studies.includes(study.id) && <Check size={12} aria-hidden="true" />}</span>{study.label}
                </button>
              ))}
              <p>Native studies · shared price time axis</p>
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

        <div className="super-chart-selected-studies" aria-label="Selected studies">
          {studies.map((id) => {
            const study = CHART_STUDIES.find((item) => item.id === id)!;
            return <span key={id}>{study.label}<button type="button" aria-label={`Remove ${study.label}`} onClick={() => toggleStudy(id)}><X size={12} /></button></span>;
          })}
          {indicators.map((id) => <span key={id} className="is-orderflow">{ORDERFLOW_ITEMS.find((item) => item.id === id)?.label}
            <button type="button" aria-label={`Remove ${ORDERFLOW_ITEMS.find((item) => item.id === id)?.label}`} onClick={() => toggleIndicator(id)}><X size={12} /></button></span>)}
          {!studies.length && !indicators.length && <span className="super-chart-no-studies">No studies selected</span>}
        </div>
        <div className="super-chart-workspace-layout">
          <div className="super-chart-workspace-main">
            <NativeChartWorkspace contract={market} studies={studies} indicators={indicators} />
          </div>
          <ChartWatchlist currentContract={market} onSelectContract={selectWatchlistContract} />
        </div>
      </main>
    </div>
  );
}
