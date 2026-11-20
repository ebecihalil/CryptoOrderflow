import { AppHeader } from '@/components/app-header';
import { AuthShowcase } from '@/components/auth-showcase';

/** Super Charts for signed-out visitors: sign in, with indicator examples around it. */
export function SuperChartsGate() {
  return (
    <div className="terminal module-app" data-testid="super-charts-gate">
      <AppHeader title="Super Charts" mark="SC" sectionLabel="Super Charts (Indicators)" subtitle="Perpetual Markets" />
      <AuthShowcase mode="signin" next="/super-charts"
        lede="Sign in to open Super Charts: orderflow and technical indicators on one chart. Free, no card needed." />
    </div>
  );
}
