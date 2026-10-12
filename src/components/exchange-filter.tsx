import { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import type { MarketExchange } from '@/types/market';
import { EXCHANGE_LABELS, MARKET_EXCHANGES } from '@/lib/exchange-options';

interface ExchangeFilterProps {
  selected: MarketExchange[];
  onChange: (selected: MarketExchange[]) => void;
  multipleOnly: boolean;
  onMultipleOnlyChange: (value: boolean) => void;
}

export function ExchangeFilter({ selected, onChange, multipleOnly, onMultipleOnlyChange }: ExchangeFilterProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const allSelected = MARKET_EXCHANGES.every((exchange) => selected.includes(exchange));
  const label = allSelected ? 'All sources'
    : selected.length === 0 ? 'No exchanges selected'
    : selected.length === 1 ? EXCHANGE_LABELS[selected[0]]
    : `${selected.length} exchanges selected`;

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <details className="exchange-select" ref={menu}>
      <summary className={`exchange-select-trigger ${!allSelected || multipleOnly ? 'filtered' : ''}`}
        data-testid="select-exchange" aria-label={`Filter exchanges: ${label}`}>
        <span>{label}{multipleOnly ? ' · multi-venue' : ''}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div className="exchange-select-menu" role="group" aria-label="Select exchanges">
        <div className="exchange-select-actions">
          <button type="button" onClick={() => onChange([...MARKET_EXCHANGES])} data-testid="button-exchanges-all">Select all</button>
          <button type="button" onClick={() => onChange([])} data-testid="button-exchanges-clear">Clear all</button>
        </div>
        {MARKET_EXCHANGES.map((exchange) => (
          <label className="exchange-select-option" key={exchange}>
            <input type="checkbox" checked={selected.includes(exchange)} data-testid={`checkbox-exchange-${exchange}`}
              onChange={(event) => onChange(event.target.checked ? [...selected, exchange] : selected.filter((value) => value !== exchange))} />
            <span>{EXCHANGE_LABELS[exchange]}</span>
          </label>
        ))}
        <label className="exchange-select-option exchange-select-multiple">
          <input type="checkbox" checked={multipleOnly} onChange={(event) => onMultipleOnlyChange(event.target.checked)}
            data-testid="checkbox-exchanges-multiple-only" />
          <span>Only multi-exchange coins</span>
        </label>
        <p>Matches any selected exchange.</p>
      </div>
    </details>
  );
}
