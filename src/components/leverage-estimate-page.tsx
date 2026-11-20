import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { RefreshCw } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { CoinLogo } from '@/components/coin-logo';
import { ExchangeLogo } from '@/components/exchange-logo';
import { LeverageEstimateChart } from '@/components/leverage-estimate-chart';
import { useLeverageEstimate, type LeverageRow, type LeverageTimeframe } from '@/hooks/use-leverage-estimate';
import '@/styles/leverage-estimate.css';
import { CoinShortcuts, WatchStar } from '@/components/coin-shortcuts';
import { useCoinMemory } from '@/hooks/use-coin-memory';

const TIMEFRAMES: Array<{ value: LeverageTimeframe; label: string }> = [
  { value: '5m', label: '5m' }, { value: '15m', label: '15m' }, { value: '30m', label: '30m' },
  { value: '1h', label: '1h' }, { value: '4h', label: '4h' }, { value: '1d', label: '1D' },
];
const QUICK_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'];
const EXCHANGE_NAMES: Record<string, string> = { binance: 'Binance', okx: 'OKX', gate: 'Gate.io', bybit: 'Bybit' };
const REGIME_COPY = {
  low: 'Leverage is light versus its own history.', normal: 'Leverage is near its typical level.',
  elevated: 'Leverage is building above normal.', extreme: 'Leverage is stretched — liquidation cascades are more likely.',
  unavailable: 'Not enough matched history yet.',
};
const BUILD_COPY: Record<LeverageRow['buildState'], string> = {
  'long-build': 'OI rising with net taker buying — leveraged longs opening',
  'short-build': 'OI rising with net taker selling — leveraged shorts opening',
  'long-unwind': 'OI falling with net taker selling — longs closing / liquidating',
  'short-unwind': 'OI falling with net taker buying — shorts covering / squeezed',
  neutral: 'No clear aggressor-led OI change in the latest bar',
};

const ok = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const pct = (value: number | null | undefined, digits = 1) => ok(value) ? `${(value * 100).toFixed(digits)}%` : '—';
const signedPct = (value: number | null | undefined, digits = 1) =>
  ok(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}%` : '—';
function usd(value: number | null | undefined) {
  if (!ok(value)) return '—';
  const abs = Math.abs(value), sign = value < 0 ? '−' : value > 0 ? '+' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
// Building side colours: long build green, short build red; zero stays neutral.
const tone = (value: number | null | undefined, up: string, down: string) => !ok(value) || value === 0 ? undefined : value > 0 ? up : down;
const plainUsd = (value: number | null | undefined) => usd(value).replace(/^\+/, '');

function ScoreGauge({ score }: { score: number | null }) {
  const value = ok(score) ? Math.max(0, Math.min(100, score)) : null;
  return (
    <div className="lev-gauge" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}
      aria-label="Leverage score">
      <div className="lev-gauge-track"><span style={{ width: `${value ?? 0}%` }} /></div>
      <div className="lev-gauge-scale"><span>Low</span><span>Normal</span><span>Elevated</span><span>Extreme</span></div>
    </div>
  );
}

function BiasBar({ bias }: { bias: number | null }) {
  const value = ok(bias) ? Math.max(-1, Math.min(1, bias)) : 0;
  return (
    <div className="lev-bias" aria-hidden="true">
      <span className="lev-bias-axis" />
      <span className={`lev-bias-fill ${value >= 0 ? 'long' : 'short'}`}
        style={value >= 0 ? { left: '50%', width: `${value * 50}%` } : { right: '50%', width: `${-value * 50}%` }} />
      <small className="lev-bias-left">Shorts</small><small className="lev-bias-right">Longs</small>
    </div>
  );
}

export function LeverageEstimatePage() {
  const [asset, setAsset] = useState('BTC');
  const [draft, setDraft] = useState('BTC');
  const [timeframe, setTimeframe] = useState<LeverageTimeframe>('1h');
  const query = useLeverageEstimate(asset, timeframe);
  const data = query.data;
  const latest = data?.latest ?? null;
  const rows = data?.rows ?? [];
  const loadingFirst = !data && query.isLoading;
  const fillingSources = !!data && data.isRefreshing && !rows.length;
  const memory = useCoinMemory('leverage');
  const { remember } = memory;
  // Remember only coins that actually returned data (not typos).
  useEffect(() => { if (data?.asset === asset && data.rows.length) remember(asset); }, [data?.asset, data?.rows.length, asset, remember]);
  const pickCoin = (coin: string) => { setAsset(coin); setDraft(coin); };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = draft.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(USDT|USD|PERP)$/, '');
    if (next) { setAsset(next); setDraft(next); }
  };

  return (
    <div className="terminal lev-app">
      <AppHeader title="Leverage Estimate" mark="LE" isRefreshing={query.isFetching || !!data?.isRefreshing} />
      <main className="lev-main">
        <nav className="module-breadcrumb" aria-label="Breadcrumb"><Link href="/">Crypto Order Flow</Link><span aria-hidden="true">/</span><span>Leverage Estimate</span></nav>
        <div className="lev-heading">
          <div>
            <span className="eyebrow">AGGREGATED PERPETUAL LEVERAGE</span>
            <h1><CoinLogo asset={asset} /> {asset} leverage estimate <WatchStar memory={memory} coin={asset} size={18} /></h1>
          </div>
          <button type="button" className="lev-refresh" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>

        <div className="lev-controls">
          <form className="lev-asset-form" onSubmit={submit}>
            <label><span>Coin</span>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Coin symbol"
                autoCapitalize="characters" spellCheck={false} placeholder="BTC" maxLength={30} />
            </label>
            <button type="submit">Apply</button>
            <div className="lev-quick" role="group" aria-label="Quick coin selection">
              {QUICK_ASSETS.map((item) => <button key={item} type="button" className={item === asset ? 'active' : ''}
                aria-pressed={item === asset} onClick={() => { setAsset(item); setDraft(item); }}>{item}</button>)}
            </div>
          </form>
          <div className="lev-timeframes" role="group" aria-label="Leverage timeframe">
            {TIMEFRAMES.map((item) => <button key={item.value} type="button" className={timeframe === item.value ? 'active' : ''}
              aria-pressed={timeframe === item.value} onClick={() => setTimeframe(item.value)}>{item.label}</button>)}
          </div>
        </div>

        <CoinShortcuts memory={memory} active={asset} onPick={pickCoin} />
        {query.error && <div className="lev-error" role="alert">{query.error.message}</div>}
        {data?.warnings.map((warning) => <div key={warning} className="lev-warning" role="status">{warning}</div>)}

        <section className="lev-cards" aria-label="Latest leverage readings">
          <article className="lev-card lev-card-score">
            <h2>Leverage score</h2>
            <p className="lev-value">{ok(latest?.leverageScore) ? latest!.leverageScore!.toFixed(0) : '—'}<small>/100</small></p>
            <ScoreGauge score={latest?.leverageScore ?? null} />
            <p className={`lev-regime ${latest?.regime ?? 'unavailable'}`}>{(latest?.regime ?? 'unavailable').toUpperCase()}</p>
            <p className="lev-note">{REGIME_COPY[latest?.regime ?? 'unavailable']}</p>
          </article>
          <article className="lev-card">
            <h2>Leverage side</h2>
            <p className={`lev-value lev-side ${latest?.side ?? 'unavailable'}`}>
              {latest?.side === 'long-heavy' ? 'Long-heavy' : latest?.side === 'short-heavy' ? 'Short-heavy'
                : latest?.side === 'balanced' ? 'Balanced' : '—'}
            </p>
            <BiasBar bias={latest?.sideBias ?? null} />
            <p className="lev-note">{latest?.side === 'long-heavy' ? 'Downside moves can trigger long liquidations.'
              : latest?.side === 'short-heavy' ? 'Upside moves can trigger a short squeeze.' : 'No dominant leveraged side.'}</p>
          </article>
          <article className="lev-card">
            <h2>OI vs spot turnover</h2>
            <p className="lev-value">{ok(latest?.vsMedian) ? `${latest!.vsMedian!.toFixed(2)}×` : '—'}<small>of normal</small></p>
            <dl className="lev-facts">
              <div><dt>Aggregate OI</dt><dd>{plainUsd(latest?.oiUsd)}</dd></div>
              <div><dt>OI ÷ avg spot bar</dt><dd>{ok(latest?.oiTurnover) ? `${latest!.oiTurnover!.toFixed(0)} bars` : '—'}</dd></div>
            </dl>
            <p className="lev-note">Perp exposure relative to real spot activity, versus its own {data?.settings.lookback ?? 200}-bar median.</p>
          </article>
          <article className="lev-card">
            <h2>Footprint · net leveraged build</h2>
            <dl className="lev-facts">
              <div><dt>Longs ({data?.settings.buildWindow ?? 24} bars)</dt><dd className={tone(latest?.netLongBuildUsd, 'pos', 'neg')}>{usd(latest?.netLongBuildUsd)}</dd></div>
              <div><dt>Shorts ({data?.settings.buildWindow ?? 24} bars)</dt><dd className={tone(latest?.netShortBuildUsd, 'neg', 'pos')}>{usd(latest?.netShortBuildUsd)}</dd></div>
              <div><dt>Taker imbalance</dt><dd>{signedPct(latest?.imbalancePct)}</dd></div>
              <div><dt>OI change (bar)</dt><dd>{usd(latest?.oiChangeUsd)}</dd></div>
            </dl>
            <p className="lev-note">{latest ? BUILD_COPY[latest.buildState] : '—'}</p>
          </article>
          <article className="lev-card">
            <h2>Top traders</h2>
            <dl className="lev-facts">
              <div><dt>Long by position size</dt><dd>{pct(latest?.topPositionLongShare)}</dd></div>
              <div><dt>Long by accounts</dt><dd>{pct(latest?.topAccountLongShare)}</dd></div>
              <div><dt>Size skew</dt><dd>{ok(latest?.sizeSkew) ? `${Math.exp(latest!.sizeSkew!).toFixed(2)}×` : '—'}</dd></div>
              <div><dt>All accounts long</dt><dd>{pct(latest?.globalAccountLongShare)}</dd></div>
            </dl>
            <p className="lev-note">{ok(latest?.sizeSkew)
              ? latest!.sizeSkew! > 0 ? 'Long top traders hold larger positions per account than short top traders.'
                : 'Short top traders hold larger positions per account than long top traders.'
              : 'Size skew = position ratio ÷ account ratio.'}
              {ok(latest?.retailDivergencePct) ? ` Retail is ${Math.abs(latest!.retailDivergencePct!).toFixed(1)} pts ${latest!.retailDivergencePct! > 0 ? 'more long' : 'more short'} than top-trader size.` : ''}</p>
          </article>
        </section>

        <section className="lev-chart-panel" aria-label="Leverage history chart">
          <div className="lev-chart-legend">
            <span><i className="score" />Leverage score (right) · price (left)</span>
            <span><i className="pressure" />OI/spot pressure, 100 = median</span>
            <span><i className="long" />Long build <i className="short" />Short build (USD per bar)</span>
          </div>
          {loadingFirst || fillingSources ? (
            <div className="lev-chart-empty" role="status">Collecting history from Binance, OKX, Gate.io and Bybit…</div>
          ) : rows.length ? <LeverageEstimateChart rows={rows} /> : (
            <div className="lev-chart-empty" role="alert">No matched leverage history is available for {asset} on this timeframe.</div>
          )}
        </section>

        <section className="lev-sources" aria-label="Leverage data sources">
          <h2>Sources</h2>
          <table>
            <thead><tr><th>Exchange</th><th>Contract</th><th>Status</th><th>Bars</th><th>Data used</th></tr></thead>
            <tbody>
              {(data?.sources ?? []).map((source) => (
                <tr key={source.exchange}>
                  <td><ExchangeLogo exchange={source.exchange} /> {EXCHANGE_NAMES[source.exchange] ?? source.exchange}</td>
                  <td>{source.symbol ?? '—'}</td>
                  <td><span className={`lev-status ${source.status.replace(/\s+/g, '-')}`} title={source.errors.join(' · ') || undefined}>{source.status}</span></td>
                  <td>{source.bars || '—'}</td>
                  <td>{source.fields.join(', ') || (source.errors[0] ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="lev-method" aria-label="Method and limitations">
          <h2>How the estimate works</h2>
          <ol>
            <li><b>OI / spot-turnover pressure (35%).</b> Each venue's open interest is divided by its own average spot turnover and compared with that venue's median, then OI-weighted. This is the TradingView script's core idea, aggregated across exchanges.</li>
            <li><b>Footprint-attributed OI build (25%).</b> Each bar's OI change is matched with aggressor-side taker buy/sell value (Binance, OKX). OI up with net buying is counted as leveraged long build, OI up with net selling as short build. Falling OI counts as unwinding.</li>
            <li><b>Top-trader crowding (20%)</b> and <b>size skew (20%).</b> OI-weighted top-trader position and account ratios (Binance, OKX, Gate.io). Position ratio ÷ account ratio shows which side holds bigger size per trader.</li>
          </ol>
          <p>Each input is ranked against its own recent history (percentile). The score is their weighted average, and the side bias combines build, size skew and top-trader position share.</p>
          <p className="lev-disclaimer">Exchanges do not publish aggregate margin, so no public data can measure true average leverage (notional ÷ margin). This is a relative estimate, not a measured leverage multiple. Missing venues are excluded, never counted as zero.</p>
        </section>
      </main>
    </div>
  );
}
