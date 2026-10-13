import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RotateCw } from 'lucide-react';
import { buildAdvancedChartConfig, type ChartExchange, type ChartStudyId } from '@/lib/supercharts';

const TRADINGVIEW_SCRIPT = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

type SuperChartWidgetProps = {
  exchange: ChartExchange;
  ticker: string;
  interval: string;
  studies: ChartStudyId[];
};

export function SuperChartWidget({ exchange, ticker, interval, studies }: SuperChartWidgetProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'delayed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const studiesKey = studies.join(',');

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setTheme(root.dataset.theme === 'dark' ? 'dark' : 'light');
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    syncTheme();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    let iframe: HTMLIFrameElement | null = null;
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setStatus((current) => current === 'loading' ? 'delayed' : current);
    }, 15_000);

    mount.replaceChildren();
    setStatus('loading');
    // Keep each script's parent intact when replacing a chart. Removing the
    // script itself does not cancel a pending download; TradingView can still
    // execute it and expects document.currentScript.parentElement to exist.
    const container = document.createElement('div');
    container.className = 'tradingview-widget-container';
    container.style.height = '100%';
    mount.appendChild(container);
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    container.appendChild(widget);

    const config = buildAdvancedChartConfig({
      exchange,
      ticker,
      interval,
      theme,
      studies: studiesKey ? studiesKey.split(',') as ChartStudyId[] : [],
    });
    const script = document.createElement('script');
    script.src = TRADINGVIEW_SCRIPT;
    script.type = 'text/javascript';
    script.async = true;
    script.text = JSON.stringify(config);
    script.addEventListener('error', () => {
      if (!cancelled) setStatus('error');
    });
    const onFrameLoad = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLIFrameElement)) return;
      iframe = target;
      window.clearTimeout(timeoutId);
      if (!cancelled) setStatus('loaded');
    };
    const insertId = window.setTimeout(() => {
      if (!cancelled) container.appendChild(script);
    }, 150);
    mount.addEventListener('load', onFrameLoad, true);

    const frameObserver = new MutationObserver(() => {
      const next = mount.querySelector('iframe');
      if (next && next !== iframe) {
        iframe = next;
        if (!next.title) next.title = `TradingView ${config.symbol} chart`;
        next.addEventListener('load', onFrameLoad);
      }
    });
    frameObserver.observe(mount, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      window.clearTimeout(insertId);
      frameObserver.disconnect();
      mount.removeEventListener('load', onFrameLoad, true);
      iframe?.removeEventListener('load', onFrameLoad);
      // Detach the whole subtree, not individual children of a pending script.
      container.remove();
    };
  }, [exchange, ticker, interval, theme, studiesKey, attempt]);

  const config = buildAdvancedChartConfig({
    exchange,
    ticker,
    interval,
    theme,
    studies: studiesKey ? studiesKey.split(',') as ChartStudyId[] : [],
  });
  const chartUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(config.symbol)}&interval=${encodeURIComponent(interval)}`;

  return (
    <section className="super-chart-frame" aria-label="TradingView advanced chart">
      <div className="super-chart-status" aria-live="polite" role="status">
        {status === 'loading' && <><span className="super-chart-loading-dot" />Loading TradingView chart…</>}
        {status === 'loaded' && <><span className="super-chart-ready-dot" />Chart frame loaded · quotes are supplied by TradingView</>}
        {status === 'delayed' && <><span className="super-chart-loading-dot" />Chart is taking longer than expected. TradingView may still be loading the requested market.</>}
        {status === 'error' && <span>TradingView’s chart script could not be loaded.</span>}
      </div>
      <div ref={mountRef} className="super-chart-mount tradingview-widget-container" />
      {(status === 'error' || status === 'delayed') && (
        <div className="super-chart-recovery">
          {status === 'error' && <button type="button" className="super-chart-retry" onClick={() => setAttempt((value) => value + 1)}>
            <RotateCw size={14} aria-hidden="true" /> Retry embed
          </button>}
          <a href={chartUrl} target="_blank" rel="noreferrer" className="super-chart-external">
            Open this symbol on TradingView <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      )}
      <div className="super-chart-attribution">
        <span>Charting by</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" aria-label="TradingView (opens in a new tab)">TradingView</a>
      </div>
    </section>
  );
}
