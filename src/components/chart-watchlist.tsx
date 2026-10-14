import { ArrowUpRight, Plus, X } from 'lucide-react';
import { useChartWatchlist, type ChartWatchlistItem } from '@/hooks/use-chart-watchlist';
import type { MarketContract } from '@/hooks/use-market-contracts';
import '@/styles/chart-watchlist.css';

type ChartWatchlistProps = {
  currentContract: MarketContract | null;
  onSelectContract: (contract: MarketContract) => void;
};

function sameAsset(left: string, right: string) {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

function sameContract(left: MarketContract, right: MarketContract) {
  return left.exchange.toLowerCase() === right.exchange.toLowerCase()
    && left.symbol.toLowerCase() === right.symbol.toLowerCase();
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function coverageLabel(item: ChartWatchlistItem) {
  const start = formatDate(item.historyStart);
  const end = formatDate(item.historyEnd);
  if (start && end) return `History ${start} – ${end}`;
  if (start) return `History since ${start}`;
  return 'History begins as collection starts';
}

function statusLabel(item: ChartWatchlistItem) {
  if (item.status === 'recording') return `${item.liveSources}/${item.totalSources} sources live`;
  if (item.status === 'starting') return 'Starting collection';
  if (item.status === 'partial') return `${item.liveSources}/${item.totalSources} sources · partial`;
  return 'Sources unavailable';
}

export function ChartWatchlist({ currentContract, onSelectContract }: ChartWatchlistProps) {
  const { data, error, pending, add, remove } = useChartWatchlist();
  const items = data?.items ?? [];
  const existingAsset = currentContract
    ? items.find((item) => sameAsset(item.asset, currentContract.asset))
    : undefined;
  const alreadySelected = Boolean(existingAsset && currentContract && sameContract(existingAsset.contract, currentContract));
  const limit = data?.limit ?? 5;
  const atCapacity = items.length >= limit && !existingAsset;
  const addDisabled = !currentContract || !data || pending || alreadySelected || atCapacity;

  const addLabel = !currentContract
    ? 'Select a contract to add'
    : alreadySelected
      ? 'Already on watchlist'
      : existingAsset
        ? `Update ${currentContract.asset} preferred venue`
        : atCapacity
          ? `Watchlist full · ${limit} coin limit`
          : `Add ${currentContract.asset} to watchlist`;

  return (
    <aside className="chart-watchlist" aria-labelledby="chart-watchlist-title">
      <header className="chart-watchlist-header">
        <div>
          <div className="chart-watchlist-eyebrow">Background collection</div>
          <h2 className="chart-watchlist-heading" id="chart-watchlist-title">Coin watchlist</h2>
        </div>
        <span className="chart-watchlist-count" aria-label={`${items.length} of ${limit} coins`}>
          {items.length}/{limit}
        </span>
      </header>

      <p className="chart-watchlist-intro">
        {data?.shared
          ? 'Shared across this server, not private to this browser.'
          : 'Server-side collection continues while you view another coin.'}
        {' '}Spot + perpetual CVD and bubble history · up to {data?.retentionDays ?? 7} days.
      </p>

      <button
        className="chart-watchlist-add"
        type="button"
        disabled={addDisabled}
        aria-label={addLabel}
        onClick={() => { if (currentContract) void add(currentContract); }}
      >
        <span>{addLabel}</span>
        {existingAsset && !alreadySelected
          ? <ArrowUpRight size={14} aria-hidden="true" />
          : <Plus size={14} aria-hidden="true" />}
      </button>
      {atCapacity && (
        <p className="chart-watchlist-capacity">
          Remove a saved coin to free a slot. Only one collector is kept per underlying asset.
        </p>
      )}

      {error && (
        <div className="chart-watchlist-error" role="alert">
          Watchlist request failed: {error} The list will retry automatically.
        </div>
      )}
      {!data && !error && (
        <div className="chart-watchlist-loading" role="status" aria-label="Loading watchlist">
          <strong>Loading saved coins</strong>
          Checking server watchlist and recorder status.
        </div>
      )}
      {data && items.length === 0 && (
        <div className="chart-watchlist-empty">
          <strong>No coins are being recorded</strong>
          Add the active contract to begin background collection. Weekly history is not prefilled; it starts now and may contain gaps.
        </div>
      )}
      {items.length > 0 && (
        <ul className="chart-watchlist-list" aria-label="Saved coins">
          {items.map((item) => {
            const active = Boolean(currentContract && sameContract(item.contract, currentContract));
            const statusClass = item.status === 'recording'
              ? 'is-recording'
              : item.status === 'partial'
                ? 'is-partial'
                : item.status === 'starting' ? 'is-starting' : '';
            return (
              <li
                className={`chart-watchlist-item${active ? ' is-active' : ''}`}
                key={item.asset.toUpperCase()}
              >
                <button
                  type="button"
                  className="chart-watchlist-select"
                  aria-current={active ? 'true' : undefined}
                  aria-label={`Show ${item.asset} chart from ${item.contract.exchange}`}
                  onClick={() => onSelectContract(item.contract)}
                >
                  <span className="chart-watchlist-asset-line">
                    <span className="chart-watchlist-asset">{item.asset}</span>
                    <span className={`chart-watchlist-status ${statusClass}`}>{statusLabel(item)}</span>
                  </span>
                  <span className="chart-watchlist-contract">
                    {item.contract.exchange.toUpperCase()} · {item.contract.symbol}
                  </span>
                  <span className="chart-watchlist-coverage">{coverageLabel(item)}</span>
                </button>
                <button
                  type="button"
                  className="chart-watchlist-remove"
                  aria-label={`Remove ${item.asset} from watchlist`}
                  title={`Remove ${item.asset}`}
                  disabled={pending}
                  onClick={() => void remove(item.asset)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {data && (data.storageWarning || data.storageFailed || items.some((item) => item.storageFailed)) && (
        <div className="chart-watchlist-storage" role="status">
          {data.storageWarning || 'Some recording data could not be written to persistent storage.'}
          {data.storageFailed && ' Storage writes are currently failing.'}
          {!data.storageFailed && items.some((item) => item.storageFailed) && ' One or more coin recorders could not persist data.'}
        </div>
      )}

      <footer className="chart-watchlist-footer">
        Collection continues server-side when switching charts. History begins when collection starts and can have gaps. Local files survive restarts only when the host preserves the data directory.
      </footer>
    </aside>
  );
}
