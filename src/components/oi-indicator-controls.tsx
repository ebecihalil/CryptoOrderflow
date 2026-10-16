import { useId, type CSSProperties } from 'react';
import type { OiDriverPayload, OiDriverSettings } from '@/hooks/use-oi-driver';
import './oi-indicator.css';

type Props = {
  settings: OiDriverSettings;
  onChange: (next: OiDriverSettings) => void;
  payload: OiDriverPayload | null;
  loading: boolean;
  error: string | null;
};

const EXCHANGES = [
  'Binance', 'Bybit', 'OKX', 'Gate.io', 'MEXC',
  'Bitget', 'BingX', 'KuCoin', 'Kraken', 'HTX',
] as const;

const COLOR_FIELDS: Array<{ key: keyof OiDriverSettings['colors']; label: string }> = [
  { key: 'up', label: 'Up candle' },
  { key: 'down', label: 'Down candle' },
  { key: 'longBuild', label: 'Long build' },
  { key: 'shortBuild', label: 'Short build' },
  { key: 'limitBuy', label: 'Limit buy' },
  { key: 'limitSell', label: 'Limit sell' },
  { key: 'shortExit', label: 'Short exit' },
  { key: 'longExit', label: 'Long exit' },
  { key: 'neutral', label: 'Neutral' },
];

const NUMBER_FIELDS: Array<{
  key: Exclude<keyof OiDriverSettings, 'showTotals' | 'stateColors' | 'showLsar' | 'colors'>;
  label: string;
  step: number;
  min: number;
  suffix?: string;
}> = [
  { key: 'flatBodyPct', label: 'Flat body threshold', step: 0.01, min: 0, suffix: '%' },
  { key: 'activityLength', label: 'Activity lookback', step: 1, min: 1, suffix: ' bars' },
  { key: 'activityFactor', label: 'Activity factor', step: 0.1, min: 0, suffix: '×' },
  { key: 'pinbarBodyPct', label: 'Pinbar body limit', step: 0.01, min: 0, suffix: '%' },
  { key: 'pinbarWickPct', label: 'Pinbar wick threshold', step: 0.01, min: 0, suffix: '%' },
  { key: 'pinbarWickRatio', label: 'Wick / body ratio', step: 0.1, min: 0, suffix: '×' },
  { key: 'spikeMult', label: 'Spike multiplier', step: 0.1, min: 0, suffix: '×' },
  { key: 'avgLength', label: 'Average lookback', step: 1, min: 1, suffix: ' bars' },
  { key: 'maxSidewaysBars', label: 'Max sideways bars', step: 1, min: 1, suffix: ' bars' },
  { key: 'pullback1', label: 'Pullback level 1', step: 0.1, min: 0, suffix: '%' },
  { key: 'pullback2', label: 'Pullback level 2', step: 0.1, min: 0, suffix: '%' },
];

function compact(value: number | null, currency = false) {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const unit = abs >= 1e9 ? 'B' : abs >= 1e6 ? 'M' : abs >= 1e3 ? 'K' : '';
  const divisor = unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
  return `${currency ? '$' : ''}${(value / divisor).toLocaleString(undefined, { maximumFractionDigits: unit ? 2 : 3 })}${unit}`;
}

function sourceKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function available(value: string | undefined) {
  if (!value) return false;
  return !/(unavailable|offline|error|missing|unsupported|unknown|not available|loading|idle|reconnect)/i.test(value);
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function OiIndicatorControls({ settings, onChange, payload, loading, error }: Props) {
  const id = useId();
  const latest = payload?.candles.at(-1);
  const sources = payload?.sources ?? [];
  const sourceFor = (exchange: string) => sources.find((source) => {
    const key = sourceKey(exchange);
    const sourceName = sourceKey(source.exchange);
    return sourceName === key || sourceName.includes(key) || key.includes(sourceName);
  });

  const update = <K extends keyof OiDriverSettings>(key: K, value: OiDriverSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };
  const updateColor = (key: keyof OiDriverSettings['colors'], value: string) => {
    onChange({ ...settings, colors: { ...settings.colors, [key]: value } });
  };

  return (
    <section className="oi-driver" aria-label="Aggregated Open Interest indicator">
      <header className="oi-driver__header">
        <div className="oi-driver__title">
          <span className="oi-driver__eyebrow">EXCHANGE-FED POSITIONING / EXECUTED FLOW</span>
          <h2>Aggregated Open Interest</h2>
          <p>{payload ? `${payload.asset} · ${payload.timeframe} · market driver` : 'Positioning context alongside executed flow'}</p>
        </div>
        <span className={`oi-driver__feed-state ${loading ? 'is-loading' : payload ? 'is-ready' : 'is-idle'}`} role="status">
          <i aria-hidden="true" />{loading ? 'Updating feed' : payload ? 'Snapshot received' : 'Awaiting feed'}
        </span>
      </header>

      {error && <div className="oi-driver__error" role="alert">
        <strong>Feed issue</strong><span>{error}</span>
      </div>}
      {loading && !payload && <div className="oi-driver__skeleton" role="status" aria-label="Loading open interest data">
        <i /><i /><i /><i />
      </div>}

      {settings.showTotals && <section className="oi-driver__totals" aria-label="Aggregated open interest totals">
        <div className="oi-driver__total oi-driver__total--primary">
          <span>Total OI · {payload?.asset ?? 'asset'}</span>
          <strong>{payload ? compact(payload.totals.oiCoin) : loading ? 'Loading' : '—'}</strong>
          <small>Aggregated coin-denominated open interest</small>
        </div>
        <div className="oi-driver__total">
          <span>Total OI · USD</span>
          <strong>{payload ? compact(payload.totals.oiUsd, true) : loading ? 'Loading' : '—'}</strong>
          <small>Exchange-reported value</small>
        </div>
        <div className="oi-driver__total">
          <span>Daily volume</span>
          <strong>{payload ? compact(payload.totals.dailyVolumeCoin) : loading ? 'Loading' : '—'}</strong>
          <small>{payload?.asset ?? 'Coin'} equivalent</small>
        </div>
        <div className="oi-driver__total">
          <span>20D average volume</span>
          <strong>{payload ? compact(payload.totals.average20dVolumeCoin) : loading ? 'Loading' : '—'}</strong>
          <small>{payload?.asset ?? 'Coin'} equivalent</small>
        </div>
      </section>}

      <section className="oi-driver__market" aria-label="Latest market driver">
        <div className="oi-driver__market-head">
          <div><span className="oi-driver__eyebrow">LATEST AGGREGATED BAR</span><h3>Market driver</h3></div>
          {latest && <time dateTime={new Date(latest.time * 1000).toISOString()}>
            {formatTime(new Date(latest.time * 1000).toISOString())}
          </time>}
        </div>
        {latest ? <>
          <div className="oi-driver__driver-line">
            <span className="oi-driver__state" style={{ '--driver-state': latest.color } as CSSProperties}>
              <i aria-hidden="true" />{latest.state || 'Unclassified'}
            </span>
            <p>{latest.note || 'No driver note supplied for this bar.'}</p>
          </div>
          <div className="oi-driver__aggression" aria-label="Buy and sell aggression">
            <div className="oi-driver__aggression-label"><span>Buy aggression <b>{latest.buyPct === null ? '—' : `${latest.buyPct.toFixed(2)}%`}</b></span>
              <span>Sell aggression <b>{latest.sellPct === null ? '—' : `${latest.sellPct.toFixed(2)}%`}</b></span></div>
            <div className="oi-driver__aggression-track" aria-hidden="true">
              <i style={{ width: `${Math.max(0, Math.min(100, latest.buyPct ?? 0))}%` }} />
            </div>
          </div>
          {(latest.spikePct !== null || latest.pullbackPct !== null || latest.alerts.length > 0) &&
            <div className="oi-driver__signals">
              {latest.spikePct !== null && <span>Activity spike <b>{latest.spikePct.toFixed(2)}%</b></span>}
              {latest.pullbackPct !== null && <span>Pullback <b>{latest.pullbackPct.toFixed(2)}%</b></span>}
              {latest.alerts.map((alert, index) => <span className="oi-driver__alert-chip" key={`${alert}-${index}`}>{alert}</span>)}
            </div>}
        </> : <div className="oi-driver__empty" role="status">
          <strong>{loading ? 'Waiting for the first bar' : 'No aggregated bar available'}</strong>
          <span>Driver interpretation appears when an exchange-fed candle is available.</span>
        </div>}
        <p className="oi-driver__caveat">Whale / retail labels are script interpretations of observed flow, not verified identities.</p>
      </section>

      <section className="oi-driver__coverage" aria-label="Exchange source coverage">
        <div className="oi-driver__section-head">
          <div><span className="oi-driver__eyebrow">FEED COVERAGE</span><h3>Venue availability</h3></div>
          <span className="oi-driver__coverage-count">{sources.filter((source) =>
            [source.oi, source.cvd, source.liquidations, source.lsar].some(available)).length}/10 listed venues reporting at least one field</span>
        </div>
        <div className="oi-driver__coverage-scroll">
          <table>
            <thead><tr><th scope="col">Exchange</th><th scope="col">OI</th><th scope="col">CVD</th><th scope="col">Liquidations</th><th scope="col">LSAR</th></tr></thead>
            <tbody>{EXCHANGES.map((exchange) => {
              const source = sourceFor(exchange);
              return <tr key={exchange}>
                <th scope="row">{exchange}</th>
                {(['oi', 'cvd', 'liquidations', 'lsar'] as const).map((field) => {
                  const state = source?.[field];
                  const ready = available(state);
                  return <td key={field}><span className={`oi-driver__coverage-status ${ready ? 'is-available' : 'is-unavailable'}`}>
                    <i aria-hidden="true" />{ready ? state : 'Unavailable'}
                  </span></td>;
                })}
              </tr>;
            })}</tbody>
          </table>
        </div>
        <p className="oi-driver__coverage-note">Coverage is shown per venue and per field. Unavailable sources are not inferred as zero; this view does not imply a complete feed.</p>
      </section>

      {payload?.warnings && payload.warnings.length > 0 && <aside className="oi-driver__warnings" aria-label="Feed warnings">
        <strong>Data notes</strong>{payload.warnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}
      </aside>}
      {payload && <p className="oi-driver__generated">Snapshot generated {formatTime(payload.generatedAt)}</p>}

      <details className="oi-driver__settings">
        <summary><span><span className="oi-driver__eyebrow">INDICATOR CONFIGURATION</span><b>Display &amp; detection settings</b></span><span className="oi-driver__settings-hint">Saved per coin by workspace</span></summary>
        <div className="oi-driver__settings-body">
          <div className="oi-driver__toggles" role="group" aria-label="Indicator display options">
            {([
              ['showTotals', 'Show totals', 'Display aggregated OI and volume figures.'],
              ['stateColors', 'State colors', 'Color bars using their interpreted market state.'],
              ['showLsar', 'Show LSAR', 'Include long / short account-ratio readings.'],
            ] as const).map(([key, label, description]) => (
              <label className="oi-driver__toggle" key={key} htmlFor={`${id}-${key}`}>
                <span><b>{label}</b><small>{description}</small></span>
                <input id={`${id}-${key}`} type="checkbox" checked={settings[key]} onChange={(event) => update(key, event.target.checked)} />
              </label>
            ))}
          </div>

          <div className="oi-driver__number-grid">
            {NUMBER_FIELDS.map(({ key, label, step, min, suffix }) => (
              <label className="oi-driver__number" key={key} htmlFor={`${id}-${key}`}>
                <span>{label}</span>
                <span className="oi-driver__input-wrap">
                  <input id={`${id}-${key}`} type="number" min={min} step={step} value={settings[key]}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value) && value >= min) update(key, value);
                    }} />
                  {suffix && <small>{suffix}</small>}
                </span>
              </label>
            ))}
          </div>

          <fieldset className="oi-driver__color-settings">
            <legend>Indicator palette</legend>
            <div>{COLOR_FIELDS.map(({ key, label }) => (
              <label key={key} htmlFor={`${id}-color-${key}`}>
                <span>{label}</span><input id={`${id}-color-${key}`} type="color" value={settings.colors[key]}
                  onChange={(event) => updateColor(key, event.currentTarget.value)} />
              </label>
            ))}</div>
          </fieldset>
          <p className="oi-driver__rule-note"><b>Liquidation threshold:</b> the 0.5% rule is fixed by the indicator logic and is not adjustable here.</p>
        </div>
      </details>
    </section>
  );
}
