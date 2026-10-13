import { useRef, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { SuperChartWidget } from '@/components/super-chart-widget';
import { OrderflowIndicators } from '@/components/orderflow-indicators';
import {
  CHART_EXCHANGES,
  CHART_INTERVALS,
  CHART_STUDIES,
  type ChartExchange,
  type ChartStudyId,
} from '@/lib/supercharts';
import '@/styles/super-charts.css';

type ChartTab = 'technical' | 'orderflow';

export function SuperChartsPage() {
  const [activeTab, setActiveTab] = useState<ChartTab>('technical');
  const [exchange, setExchange] = useState<ChartExchange>('BINANCE');
  const [ticker, setTicker] = useState('BTCUSDT');
  const [tickerDraft, setTickerDraft] = useState('BTCUSDT');
  const [interval, setInterval] = useState('60');
  const [studies, setStudies] = useState<ChartStudyId[]>(['rsi']);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const activateTab = (tab: ChartTab) => setActiveTab(tab);
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: ChartTab) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next: ChartTab = event.key === 'Home' ? 'technical'
      : event.key === 'End' ? 'orderflow'
        : current === 'technical' ? 'orderflow' : 'technical';
    activateTab(next);
    tabsRef.current[next === 'technical' ? 0 : 1]?.focus();
  };
  const toggleStudy = (id: ChartStudyId) => {
    setStudies((current) => current.includes(id) ? current.filter((study) => study !== id) : [...current, id]);
  };
  const submitTicker = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = tickerDraft.trim().toUpperCase().replace(/\s+/g, '');
    if (next) {
      setTicker(next);
      setTickerDraft(next);
    }
  };

  return (
    <div className="terminal module-app super-charts-app">
      <AppHeader title="Super Charts" mark="SC" sectionLabel="Super Charts (Indicators)" subtitle="Perpetual Markets" />
      <main className="super-charts-main">
        <div className="super-charts-heading">
          <div className="module-kicker"><span className="module-kicker-rule" /> MARKET TOOLKIT / CHARTING</div>
          <h1 className="module-page-title">Super Charts</h1>
          <p>Technical studies and price-derived liquidity zones across hosted perpetual markets.</p>
        </div>

        <div className="super-chart-tabs" role="tablist" aria-label="Chart indicator categories">
          <button ref={(node) => { tabsRef.current[0] = node; }} type="button" role="tab"
            id="super-charts-tab-technical" aria-controls="super-charts-panel-technical"
            aria-selected={activeTab === 'technical'} tabIndex={activeTab === 'technical' ? 0 : -1}
            onClick={() => activateTab('technical')} onKeyDown={(event) => onTabKeyDown(event, 'technical')}>
            Technical Indicators
          </button>
          <button ref={(node) => { tabsRef.current[1] = node; }} type="button" role="tab"
            id="super-charts-tab-orderflow" aria-controls="super-charts-panel-orderflow"
            aria-selected={activeTab === 'orderflow'} tabIndex={activeTab === 'orderflow' ? 0 : -1}
            onClick={() => activateTab('orderflow')} onKeyDown={(event) => onTabKeyDown(event, 'orderflow')}>
            Orderflow Indicators
          </button>
        </div>

        {activeTab === 'technical' ? (
          <section id="super-charts-panel-technical" role="tabpanel" aria-labelledby="super-charts-tab-technical" className="super-chart-panel">
            <div className="super-chart-toolbar">
              <div className="super-chart-controls">
                <label className="super-chart-control">
                  <span>Exchange</span>
                  <select value={exchange} onChange={(event) => setExchange(event.target.value as ChartExchange)} aria-label="Exchange">
                    {CHART_EXCHANGES.map((venue) => <option value={venue.id} key={venue.id}>{venue.label}</option>)}
                  </select>
                </label>
                <form className="super-chart-symbol-form" onSubmit={submitTicker}>
                  <label className="super-chart-control">
                    <span>Perpetual symbol</span>
                    <input value={tickerDraft} onChange={(event) => setTickerDraft(event.target.value)}
                      aria-label="Perpetual ticker" autoCapitalize="characters" spellCheck={false} placeholder="BTCUSDT" />
                  </label>
                  <button type="submit" className="super-chart-apply">Apply</button>
                </form>
              </div>
              <div className="super-chart-timeframes" role="group" aria-label="Chart timeframe">
                {CHART_INTERVALS.map((item) => (
                  <button key={item.value} type="button" className={interval === item.value ? 'active' : ''}
                    aria-pressed={interval === item.value} onClick={() => setInterval(item.value)}>{item.label}</button>
                ))}
              </div>
            </div>

            <div className="super-chart-study-row" role="group" aria-label="Technical studies">
              <span className="super-chart-study-label">Studies</span>
              {CHART_STUDIES.map((study) => (
                <label className="super-chart-study" key={study.id}>
                  <input type="checkbox" checked={studies.includes(study.id)} onChange={() => toggleStudy(study.id)} />
                  <span>{study.label}</span>
                </label>
              ))}
              <span className="super-chart-study-hint">More studies are available from the chart’s Indicators menu.</span>
            </div>
            <SuperChartWidget exchange={exchange} ticker={ticker} interval={interval} studies={studies} />
            <p className="super-chart-disclaimer">Market symbols and availability are determined by TradingView. Perpetual contract coverage varies by exchange; unsupported symbols are handled by TradingView.</p>
          </section>
        ) : (
          <section id="super-charts-panel-orderflow" role="tabpanel" aria-labelledby="super-charts-tab-orderflow" className="super-orderflow-panel">
            <OrderflowIndicators />
          </section>
        )}
      </main>
    </div>
  );
}
