import { AppHeader } from '@/components/app-header';
import { AuthForm } from '@/components/auth-ui';
import { DataSources } from '@/components/data-sources';
import { IndicatorShowcaseCard } from '@/components/indicator-showcase';
import '@/styles/super-charts-gate.css';

/** Super Charts for signed-out visitors: sign in, with indicator examples around it. */
export function SuperChartsGate() {
  return (
    <div className="terminal module-app">
      <AppHeader title="Super Charts" mark="SC" sectionLabel="Super Charts (Indicators)" subtitle="Perpetual Markets" />
      <main className="sc-gate-main" data-testid="super-charts-gate">
        <div className="sc-gate-grid">
          <div className="sc-gate-side">
            <IndicatorShowcaseCard kind="bubbles" />
            <IndicatorShowcaseCard kind="lsar" />
          </div>
          <div className="sc-gate-center">
            <AuthForm mode="signin" next="/super-charts"
              lede="Sign in to open Super Charts: orderflow and technical indicators on one chart. Free, no card needed." />
          </div>
          <div className="sc-gate-side">
            <IndicatorShowcaseCard kind="leverage" />
            <IndicatorShowcaseCard kind="cvd" />
          </div>
        </div>
        <p className="sc-gate-pitch">
          Orderflow indicators built from as much exchange data as possible for the most accurate aggregated view,
          plus all the major technical indicators.
        </p>
        <DataSources />
        <p className="sc-gate-note">Indicator pictures are examples; Super Charts shows live exchange data.</p>
      </main>
    </div>
  );
}
