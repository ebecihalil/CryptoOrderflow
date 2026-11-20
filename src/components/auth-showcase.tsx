import { useEffect } from 'react';
import { useLocation, useSearch } from 'wouter';
import { AppHeader } from '@/components/app-header';
import { AuthForm } from '@/components/auth-ui';
import { DataSources } from '@/components/data-sources';
import { IndicatorShowcaseCard } from '@/components/indicator-showcase';
import { safeNext, useAuth } from '@/hooks/use-auth';
import '@/styles/super-charts-gate.css';

/** Sign in / sign up form with indicator examples around it (Super Charts gate and the /signin, /signup pages). */
export function AuthShowcase({ mode, next, lede }: { mode: 'signup' | 'signin'; next: string; lede?: string }) {
  return (
    <main className="sc-gate-main" data-testid="auth-showcase">
      <div className="sc-gate-grid">
        <div className="sc-gate-side">
          <IndicatorShowcaseCard kind="bubbles" />
          <IndicatorShowcaseCard kind="lsar" />
        </div>
        <div className="sc-gate-center">
          <AuthForm mode={mode} next={next} lede={lede} />
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
  );
}

/** /signin and /signup: same view as the Super Charts sign-in. */
export function AuthPage({ mode }: { mode: 'signup' | 'signin' }) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const next = safeNext(new URLSearchParams(search).get('next'));
  useEffect(() => { if (user) navigate(next, { replace: true }); }, [user, next, navigate]);
  return (
    <div className="terminal module-app">
      <AppHeader title="Crypto Order Flow" mark="CO" sectionLabel={mode === 'signup' ? 'Sign up' : 'Sign in'} subtitle="Market Toolkit" />
      <AuthShowcase mode={mode} next={next} />
    </div>
  );
}
