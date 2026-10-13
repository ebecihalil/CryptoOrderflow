import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { LiquidityZoneChart } from '@/components/liquidity-zone-chart';
import { useLiquidityCandles, type LiquidityExchange, type LiquidityTimeframe, type LiquidityVolumeMode } from '@/hooks/use-liquidity-candles';
import { calculateLiquidityZones, type LiquiditySettings } from '@/lib/liquidity-zones';
import '@/styles/liquidity-zones.css';

const TIMEFRAMES: Array<{ value: LiquidityTimeframe; label: string }> = [
  { value: '5m', label: '5m' }, { value: '15m', label: '15m' }, { value: '30m', label: '30m' },
  { value: '1h', label: '1h' }, { value: '4h', label: '4h' }, { value: '24h', label: '1D' },
];

const DEFAULT_SETTINGS: LiquiditySettings = { backBars: 300, volMult: 1.2 };
const DEFAULT_COLORS = { resistance: '#ff0000', support: '#008000', inside: '#808080', transparency: 35 };

function formatTimestamp(time: number) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(time * 1000)) + ' UTC';
}

export function OrderflowIndicators() {
  const [exchange, setExchange] = useState<LiquidityExchange>('binance');
  const [tickerDraft, setTickerDraft] = useState('BTCUSDT');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState<LiquidityTimeframe>('1h');
  const [volumeMode, setVolumeMode] = useState<LiquidityVolumeMode>('aggregated');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [showVolume, setShowVolume] = useState(true);
  const feed = useLiquidityCandles(exchange, symbol, timeframe, volumeMode);
  const payloadModeMatches = feed.payload?.volumeMode === volumeMode ||
    (volumeMode === 'single' && feed.payload?.volumeMode === undefined);
  const candles = feed.payload && feed.payload.exchange === exchange &&
    feed.payload.symbol === symbol && feed.payload.timeframe === timeframe && payloadModeMatches ? feed.payload.candles : [];
  const calculated = useMemo(() => calculateLiquidityZones(candles, settings), [candles, settings]);
  const latestSignals = [...calculated.signals].sort((a, b) => b.time - a.time).slice(0, 5);
  const applyTicker = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = tickerDraft.trim().toUpperCase().replace(/\s+/g, '');
    if (next) setSymbol(next);
  };
  const setSetting = (key: keyof LiquiditySettings, value: number) => setSettings((current) => ({ ...current, [key]: value }));
  const isCurrentFeed = !!feed.payload && feed.payload.exchange === exchange &&
    feed.payload.symbol === symbol && feed.payload.timeframe === timeframe && payloadModeMatches;
  const fetchedLabel = isCurrentFeed ? formatTimestamp(Math.floor(new Date(feed.payload!.fetchedAt).getTime() / 1000)) : null;
  const feedWarning = feed.error || (isCurrentFeed ? feed.payload?.error : undefined);
  const orderedSources = ['binance', 'okx', 'gate', 'bybit'] as const;
  const sourceLabels: Record<(typeof orderedSources)[number], string> = {
    binance: 'Binance', okx: 'OKX', gate: 'Gate.io', bybit: 'Bybit',
  };
  const volumeSources = volumeMode === 'aggregated' && isCurrentFeed ? feed.payload?.volumeSources ?? [] : [];
  const availableSourceCount = volumeSources.filter((source) => source.status === 'ok').length;
  const availableAlignedBars = isCurrentFeed && volumeMode === 'aggregated'
    ? feed.payload?.matchedCandleCount ?? 0
    : candles.length;
  const historyShort = candles.length > 0 && availableAlignedBars < settings.backBars + 30;
  const latestAlignedTime = candles.length ? formatTimestamp(candles[candles.length - 1].time) : null;

  return (
    <section className="super-chart-panel orderflow-panel" aria-label="Liquidity Zones indicator">
      <div className="liquidity-toolbar">
        <div className="liquidity-market-controls">
          <label className="super-chart-control">
            <span>Exchange</span>
            <select value={exchange} onChange={(event) => setExchange(event.target.value as LiquidityExchange)} aria-label="Orderflow exchange">
              <option value="binance">Binance</option>
              <option value="bybit">Bybit</option>
            </select>
          </label>
          <form className="super-chart-symbol-form" onSubmit={applyTicker}>
            <label className="super-chart-control"><span>Perpetual symbol</span>
              <input value={tickerDraft} onChange={(event) => setTickerDraft(event.target.value)} aria-label="Orderflow perpetual symbol"
                autoCapitalize="characters" spellCheck={false} placeholder="BTCUSDT" />
            </label>
            <button type="submit" className="super-chart-apply">Apply</button>
          </form>
        </div>
        <label className="super-chart-control liquidity-volume-basis">
          <span>Volume basis</span>
          <select value={volumeMode} onChange={(event) => setVolumeMode(event.target.value as LiquidityVolumeMode)}
            aria-label="Volume basis">
            <option value="aggregated">Aggregated (4 exchanges)</option>
            <option value="single">Selected exchange</option>
          </select>
        </label>
        <div className="liquidity-feed-tools">
          <span className="liquidity-feed-stamp">{feed.loading && !isCurrentFeed ? 'Loading market candles' : fetchedLabel ? `Feed · ${fetchedLabel}` : 'Feed unavailable'}</span>
          <button type="button" className="liquidity-refresh" onClick={feed.refresh} disabled={feed.loading} aria-label="Refresh market candles">
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      <div className="liquidity-chart-toolbar">
        <div className="super-chart-timeframes" role="group" aria-label="Liquidity chart timeframe">
          {TIMEFRAMES.map((item) => <button key={item.value} type="button" className={timeframe === item.value ? 'active' : ''}
            aria-pressed={timeframe === item.value} onClick={() => setTimeframe(item.value)}>{item.label}</button>)}
        </div>
        <label className="liquidity-volume-toggle"><input type="checkbox" checked={showVolume}
          onChange={(event) => setShowVolume(event.target.checked)} /><span>Volume</span></label>
        <span className="liquidity-zone-count">{calculated.zones.length} qualified zones</span>
      </div>

      {volumeMode === 'aggregated' && (
        <div className="liquidity-volume-summary" aria-label="Aggregated volume source status">
          <span className="liquidity-volume-unit">
            {isCurrentFeed && feed.payload?.volumeAsset ? `${feed.payload.volumeAsset} traded` : 'Underlying coin traded'}
          </span>
          <span className="liquidity-source-list">
            {orderedSources.map((exchangeName) => {
              const source = volumeSources.find((item) => item.exchange === exchangeName);
              const ok = source?.status === 'ok' && !feed.payload?.stale;
              return <span key={exchangeName} className={`liquidity-source${ok ? ' is-ok' : ' is-unavailable'}`}
                title={ok ? `${sourceLabels[exchangeName]} volume included` : `${sourceLabels[exchangeName]} volume unavailable, cached or not listed`}>
                <i aria-hidden="true" />{sourceLabels[exchangeName]}
              </span>;
            })}
          </span>
          <span className="liquidity-source-count">
            {isCurrentFeed ? `${availableSourceCount}/4 contributing` : feed.loading ? 'Aligning sources…' : 'Source status unavailable'}
            {isCurrentFeed && feed.payload?.stale ? ' · cached' : feed.payload?.partialVolume ? ' · partial' : ''}
          </span>
          {isCurrentFeed && feed.payload?.matchedCandleCount !== undefined && (
            <span className="liquidity-alignment">
              {feed.payload.matchedCandleCount} aligned / {settings.backBars} scan + 30 warmup
              {latestAlignedTime ? ` · latest ${latestAlignedTime}` : ''}
            </span>
          )}
        </div>
      )}
      {historyShort && (
        <div className="liquidity-history-warning" role="status">
          Available aligned history ({availableAlignedBars} candles) is shorter than the {settings.backBars}-bar scan plus 30-bar warmup; zones may be incomplete.
        </div>
      )}
      {feedWarning && (
        <div className={`liquidity-feed-warning${feed.payload?.stale ? ' is-stale' : ''}`} role="status">
          <span>{feed.payload?.stale ? 'Cached market data · ' : 'Market feed · '}{feedWarning}</span>
          {fetchedLabel && <time dateTime={feed.payload?.fetchedAt}>Last update {fetchedLabel}</time>}
        </div>
      )}
      {feed.loading && !candles.length ? (
        <div className="liquidity-chart-skeleton" aria-label="Loading market candles">
          <div className="liquidity-skeleton-label" /><div className="liquidity-skeleton-bars" />
        </div>
      ) : candles.length ? (
        <LiquidityZoneChart candles={candles} zones={calculated.zones} showVolume={showVolume} colors={colors} />
      ) : (
        <div className="liquidity-chart-empty" role="alert">
          <strong>Market candles unavailable</strong>
          <span>{feed.error || 'No candle history was returned for this perpetual market.'}</span>
          <button type="button" onClick={feed.refresh}>Retry feed</button>
        </div>
      )}

      <div className="liquidity-details">
        <section className="liquidity-settings" aria-labelledby="liquidity-settings-heading">
          <div className="liquidity-section-title"><span className="eyebrow">INDICATOR CONTROLS</span><h2 id="liquidity-settings-heading">Liquidity Zones</h2></div>
          <label className="liquidity-range-control">
            <span><b>Bars to apply</b><output>{settings.backBars} bars</output></span>
            <input type="range" min="50" max="900" step="1" value={settings.backBars}
              onChange={(event) => setSetting('backBars', Number(event.target.value))} />
          </label>
          <label className="liquidity-range-control">
            <span><b>Volume sensitivity</b><output>{settings.volMult.toFixed(1)}× average</output></span>
            <input type="number" min="0.1" step="0.1" value={settings.volMult}
              aria-label="Volume sensitivity"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 0.1) setSetting('volMult', value);
              }} />
          </label>
          <p className="liquidity-capacity-note">History capacity is limited to the 1,000 candles provided by the market feed.</p>
          <div className="liquidity-style-controls">
            <label><span>Resistance</span><input aria-label="Resistance color" type="color" value={colors.resistance}
              onChange={(event) => setColors((current) => ({ ...current, resistance: event.target.value }))} /></label>
            <label><span>Support</span><input aria-label="Support color" type="color" value={colors.support}
              onChange={(event) => setColors((current) => ({ ...current, support: event.target.value }))} /></label>
            <label><span>In-zone</span><input aria-label="In-zone color" type="color" value={colors.inside}
              onChange={(event) => setColors((current) => ({ ...current, inside: event.target.value }))} /></label>
          </div>
          <label className="liquidity-range-control transparency-control">
            <span><b>Fill transparency</b><output>{colors.transparency}%</output></span>
            <input type="range" min="0" max="100" step="1" value={colors.transparency}
              onChange={(event) => setColors((current) => ({ ...current, transparency: Number(event.target.value) }))} />
          </label>
        </section>

        <section className="liquidity-signals" aria-labelledby="liquidity-signals-heading">
          <div className="liquidity-section-title"><span className="eyebrow">LATEST ACTIVITY</span><h2 id="liquidity-signals-heading">Zone signals</h2></div>
          {!latestSignals.length ? <p className="liquidity-no-signals">No recent zone signals in the available history.</p> : (
            <ul>
              {latestSignals.map((signal, index) => (
                <li key={`${signal.time}-${signal.type}-${index}`}>
                  <span className={`liquidity-signal-dot ${signal.type}`} aria-hidden="true" />
                  <span className="liquidity-signal-copy"><b>{signal.type === 'breakout' ? 'Breakout' : 'Touch'}</b>
                    <small>{signal.zoneIds.length} zone{signal.zoneIds.length === 1 ? '' : 's'} · {formatTimestamp(signal.time)}</small></span>
                  {!signal.closed && <span className="liquidity-provisional">Provisional</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="liquidity-signal-footnote">Forming-candle signals can change before the interval closes.</p>
        </section>
      </div>
      <div className="liquidity-method-note">
        <span className="liquidity-note-mark">i</span>
        <p>
          {volumeMode === 'aggregated'
            ? 'Aggregated volume sums matched underlying-coin trade volume; it is not open interest weighted. Price and OHLC remain from the selected exchange. Candle timestamps are matched exactly; unavailable or unmatched exchange data is excluded, never treated as zero.'
            : 'Volume and OHLC use the selected exchange only.'}
          {' '}The selected volume basis feeds both chart bars and indicator volume qualification. Pivots confirm after 10 bars, so displayed left boundaries are back-painted. Initial feed history warmup can differ from TradingView.
          {' '}<a href="/api/indicators/liquidity-zones/source" target="_blank" rel="noreferrer">Indicator source</a> · <a href="https://mozilla.org/MPL/2.0/" target="_blank" rel="noreferrer">MPL 2.0</a>
        </p>
      </div>
    </section>
  );
}
