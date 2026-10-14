import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, RotateCw, X } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { MarketAutocomplete, type AutocompleteOption } from '@/components/market-autocomplete';
import { SuperChartWidget } from '@/components/super-chart-widget';
import { OrderflowIndicators } from '@/components/orderflow-indicators';
import { AggregatedFundingIndicator } from '@/components/aggregated-funding-indicator';
import { useMarketContracts, type MarketContract } from '@/hooks/use-market-contracts';
import type { LiquidityExchange } from '@/hooks/use-liquidity-candles';
import {
  CHART_STUDIES,
  type ChartExchange,
  type ChartStudyId,
} from '@/lib/supercharts';
import '@/styles/super-charts.css';

type MenuId = 'technical' | 'orderflow' | null;
type OrderflowId = 'liquidity' | 'funding';
const ORDERFLOW_ITEMS: Array<{ id: OrderflowId; label: string }> = [
  { id: 'liquidity', label: 'Liquidity Zones' },
  { id: 'funding', label: 'Aggregated Funding Rate' },
];
const ALLOWED_EXCHANGES = new Set(['binance', 'gate', 'okx', 'bybit', 'mexc', 'bitget', 'bingx']);

export function SuperChartsPage() {
  const [studies, setStudies] = useState<ChartStudyId[]>(['rsi']);
  const [indicators, setIndicators] = useState<OrderflowId[]>(['liquidity']);
  const [menu, setMenu] = useState<MenuId>(null);
  const [market, setMarket] = useState<MarketContract | null>(null);
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
    const bitcoin = contracts.find((contract) => contract.exchange.toLowerCase() === 'binance' && contract.asset.toUpperCase() === 'BTC')
      ?? contracts.find((contract) => contract.asset.toUpperCase() === 'BTC');
    const catalogueStillLoading = catalogue.data?.sources.some((source) => source.status === 'loading') ?? false;
    if (!bitcoin && catalogueStillLoading) return;
    const initial = bitcoin ?? contracts[0];
    setMarket(initial);
    setMarketDraft(initial.label);
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
    if (selected) setMarket(selected);
  };
  const toggleStudy = (id: ChartStudyId) => setStudies((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleIndicator = (id: OrderflowId) => setIndicators((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const chartExchange = (market?.tvExchange ?? 'BINANCE') as ChartExchange;
  const chartTicker = market?.ticker ?? 'BTCUSDT';
  const activeContract = market ?? null;

  return (
    <div className="terminal module-app super-charts-app">
      <AppHeader title="Super Charts" mark="SC" sectionLabel="Super Charts (Indicators)" subtitle="Perpetual Markets" />
      <main className="super-charts-main">
        <div className="super-charts-heading">
          <div className="module-kicker"><span className="module-kicker-rule" /> MARKET TOOLKIT / CHARTING</div>
          <h1 className="module-page-title">Super Charts</h1>
          <p>Technical studies, liquidity zones and multi-exchange funding across perpetual markets.</p>
        </div>

        <section className="super-chart-marketbar" aria-label="Chart market selection">
          <div className="super-chart-market-copy">
            <span className="super-chart-market-kicker">ACTIVE CONTRACT</span>
            <strong>{activeContract?.asset ?? 'Select a contract'}</strong>
            <small>{activeContract ? `${activeContract.exchange.toUpperCase()} native · ${activeContract.symbol}` : 'Choose from the live catalogue'}</small>
          </div>
          <label className="super-chart-contract-field">
            <span>Perpetual contract</span>
            <MarketAutocomplete
              value={marketDraft}
              onChange={selectMarket}
              options={options}
              label="Search perpetual contracts"
              placeholder={catalogue.loading ? 'Loading contract catalogue…' : 'Search contract or asset'}
              className="super-chart-contract-combo"
              inputClassName="super-chart-contract-input"
              autoCapitalize="characters"
              disabled={catalogue.loading && !catalogue.data}
            />
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
            <button type="button" className="super-chart-menu-trigger" aria-haspopup="true"
              aria-expanded={menu === 'technical'} onClick={() => setMenu((current) => current === 'technical' ? null : 'technical')}>
              Technical Indicators <span className="super-chart-selection-count">{studies.length}</span><ChevronDown size={14} aria-hidden="true" />
            </button>
            {menu === 'technical' && <div className="super-chart-menu" role="group" aria-label="Technical indicators">
              {CHART_STUDIES.map((study) => (
                <button type="button" key={study.id} className={studies.includes(study.id) ? 'is-selected' : ''}
                  aria-pressed={studies.includes(study.id)} onClick={() => toggleStudy(study.id)}>
                  <span className="super-chart-menu-check">{studies.includes(study.id) && <Check size={12} aria-hidden="true" />}</span>
                  {study.label}
                </button>
              ))}
              <p>Selections rebuild the TradingView widget.</p>
            </div>}
          </div>
          <div className="super-chart-dropdown">
            <button type="button" className="super-chart-menu-trigger" aria-haspopup="true"
              aria-expanded={menu === 'orderflow'} onClick={() => setMenu((current) => current === 'orderflow' ? null : 'orderflow')}>
              Orderflow Indicators <span className="super-chart-selection-count">{indicators.length}</span><ChevronDown size={14} aria-hidden="true" />
            </button>
            {menu === 'orderflow' && <div className="super-chart-menu" role="group" aria-label="Orderflow indicators">
              {ORDERFLOW_ITEMS.map((item) => (
                <button type="button" key={item.id} className={indicators.includes(item.id) ? 'is-selected' : ''}
                  aria-pressed={indicators.includes(item.id)} onClick={() => toggleIndicator(item.id)}>
                  <span className="super-chart-menu-check">{indicators.includes(item.id) && <Check size={12} aria-hidden="true" />}</span>
                  {item.label}
                </button>
              ))}
              <p>Exchange-data panels appear below the hosted chart.</p>
            </div>}
          </div>
        </div>

        <div className="super-chart-selected-studies" aria-label="Selected technical studies">
          {studies.map((id) => {
            const study = CHART_STUDIES.find((item) => item.id === id)!;
            return <span key={id}>{study.label}<button type="button" aria-label={`Remove ${study.label}`} onClick={() => toggleStudy(id)}><X size={12} /></button></span>;
          })}
          {!studies.length && <span className="super-chart-no-studies">No additional studies selected</span>}
        </div>

        <SuperChartWidget exchange={chartExchange} ticker={chartTicker} interval="60" studies={studies} />
        <p className="super-chart-disclaimer">TradingView remains an independent hosted chart. Its symbol and timeframe controls are not synchronized with the exchange-data panels below.</p>

        <section className="super-orderflow-stack" aria-label="Exchange-data orderflow indicators">
          <div className="super-orderflow-stack-heading">
            <div><span className="module-kicker">EXCHANGE DATA / INDEPENDENT CONTROLS</span><h2>Orderflow panels</h2></div>
            <p>Panel timeframes are independent of the TradingView iframe.</p>
          </div>
          {indicators.length === 0 ? (
            <div className="super-orderflow-empty"><span className="super-orderflow-empty-mark">OF</span><span className="eyebrow">NO ORDERFLOW PANELS</span><h2>Add an indicator above</h2><p>Funding and liquidity data stay separate from the hosted TradingView chart.</p></div>
          ) : indicators.map((id) => (
            <section className="super-orderflow-card" key={id} aria-label={id === 'liquidity' ? 'Liquidity Zones panel' : 'Aggregated Funding Rate panel'}>
              <header><span>{id === 'liquidity' ? 'LIQUIDITY ZONES' : 'AGGREGATED FUNDING RATE'}</span>
                <button type="button" onClick={() => toggleIndicator(id)} aria-label={`Remove ${id === 'liquidity' ? 'Liquidity Zones' : 'Aggregated Funding Rate'} panel`}><X size={14} aria-hidden="true" /> Remove</button>
              </header>
              {id === 'liquidity'
                ? <OrderflowIndicators exchange={(market?.exchange ?? 'binance') as LiquidityExchange} symbol={market?.symbol ?? 'BTCUSDT'} />
                : <AggregatedFundingIndicator asset={market?.asset ?? 'BTC'} />}
            </section>
          ))}
        </section>
      </main>
    </div>
  );
}
