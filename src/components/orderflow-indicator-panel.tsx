import { useState } from 'react';
import { AggregatedFundingIndicator } from '@/components/aggregated-funding-indicator';
import { OrderflowIndicators as LiquidityZonesIndicator } from '@/components/orderflow-indicators';

type IndicatorChoice = 'liquidity' | 'funding';

export function OrderflowIndicatorPanel() {
  const [indicator, setIndicator] = useState<IndicatorChoice>('liquidity');
  return (
    <div className="orderflow-indicator-selector">
      <div className="super-chart-toolbar">
        <label className="super-chart-control">
          <span>Orderflow indicator</span>
          <select aria-label="Orderflow indicator" value={indicator}
            onChange={(event) => setIndicator(event.target.value as IndicatorChoice)}>
            <option value="liquidity">Liquidity Zones</option>
            <option value="funding">Aggregated Funding Rate</option>
          </select>
        </label>
      </div>
      {indicator === 'liquidity' ? <LiquidityZonesIndicator /> : <AggregatedFundingIndicator />}
    </div>
  );
}
