import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { HomeButton } from '@/components/home-button';
import { ThemeToggle } from '@/components/theme-toggle';
import type { HealthStatus } from '@/types/market';
import '@/styles/app-header.css';

type AppHeaderProps = {
  title: string;
  mark: string;
  sectionLabel?: string;
  subtitle?: string;
  isRefreshing?: boolean;
};

export function AppHeader({
  title,
  mark,
  sectionLabel = title,
  subtitle = 'Perpetual Markets',
  isRefreshing = false,
}: AppHeaderProps) {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async ({ signal }): Promise<HealthStatus> => {
      const response = await fetch('/api/healthz', { signal });
      if (!response.ok) throw new Error('API unreachable');
      return response.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const feedLabel = health.isError ? 'API unreachable' : 'Market feed';

  return (
    <>
      <header className="topbar app-header">
        <Link href="/" className="app-header-brand" aria-label="Crypto Order Flow home">
          <span className="brand-mark">{mark}</span>
          <span className="app-header-copy"><strong>{title}</strong><small>{subtitle}</small></span>
        </Link>
        <div className="app-header-controls">
          <HomeButton />
          <span className="app-header-section" aria-current="page">
            <span className="app-header-section-mark">{mark}</span>
            <span>{sectionLabel}</span>
          </span>
          <span className={`app-header-feed${health.isError ? ' api-down' : health.isPending ? ' checking' : ''}`}
            data-testid="status-api-health" role="status" aria-label={feedLabel}
            title={health.isError ? 'API unreachable' : health.isPending ? 'Checking API connection' : 'API connected. Exchange availability is shown below.'}>
            <span className="live-dot" aria-hidden="true" />
            <span className="app-header-feed-label">{feedLabel}</span>
          </span>
          <ThemeToggle />
        </div>
      </header>
      {isRefreshing && <div className="refreshing-bar" data-testid="status-refreshing" />}
    </>
  );
}
