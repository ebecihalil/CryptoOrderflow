import { Link } from 'wouter';
import { useState } from 'react';
import { ArrowUpRight, ChevronDown, Clock3 } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { HomeButton } from '@/components/home-button';
import { HOME_MODULES, type ModuleInfo } from '@/lib/modules';
import { useI18n } from '@/lib/i18n';
import { DataSources } from '@/components/data-sources';

function ProductHeader({ module }: { module?: ModuleInfo }) {
  return (
    <AppHeader title={module?.title ?? 'Crypto Order Flow'} mark={module?.mark ?? 'CO'}
      sectionLabel={module?.title ?? 'Overview'} subtitle={module ? 'Perpetual Markets' : 'Market Toolkit'} />
  );
}

/** A home card that expands to show its options (e.g. Global / Top Trader LSAR). */
function ModuleGroupEntry({ module, index }: { module: ModuleInfo; index: number }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const panelId = `module-options-${module.mark}`;
  return (
    <article className={`module-entry module-entry-group${open ? ' is-open' : ''}`} data-testid={`module-group-${module.mark}`}>
      <div className="module-entry-row">
        <span className="module-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="module-mark">{module.mark}</span>
        <div className="module-entry-copy">
          <h3><button type="button" className="module-title-button" onClick={() => setOpen(!open)}
            aria-expanded={open} aria-controls={panelId}>{t(module.title)}</button></h3>
          <p>{t(module.description)}</p>
        </div>
        <button type="button" className="module-expand" onClick={() => setOpen(!open)} aria-expanded={open}
          aria-controls={panelId} aria-label={`${open ? 'Hide' : 'Show'} ${module.title} options`} data-testid={`button-expand-${module.mark}`}>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="ratio-options" id={panelId}>
          {module.children?.map((child) => (
            <Link key={child.path} href={child.path} className="ratio-option" data-testid={`link-option-${child.mark}`}>
              <span className="ratio-option-mark">{child.mark}</span>
              <span><strong>{t(child.title.replace(' Long Short Account Ratio', ''))}</strong><small>{t(child.description)}</small></span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}

export function ModuleHome() {
  const { t } = useI18n();
  return (
    <div className="terminal module-app">
      <ProductHeader />
      <main className="module-main module-home-main">
        <div className="module-kicker module-home-kicker"><span className="module-kicker-rule" /> {t('MARKET MECHANICS')}</div>
        <h1 className="module-page-title module-home-title">Crypto Order Flow</h1>
        <p className="module-home-intro module-home-lede">{t('A clear read on positioning, participation, and pressure across perpetual markets.')}</p>

        <section className="module-directory" aria-label="Market modules">
          <div className="directory-heading">
            <div><h2>{t('Choose a market lens')}</h2></div>
            <span className="directory-count">{String(HOME_MODULES.length).padStart(2, '0')} {t('MODULES')}</span>
          </div>
          <div className="module-list">
            {HOME_MODULES.map((module, index) => module.children ? (
              <ModuleGroupEntry key={module.path} module={module} index={index} />
            ) : (
              <article key={module.path} className={`module-entry${module.path === '/super-charts' ? ' module-entry-super-charts' : ''}`}>
                <div className="module-entry-row">
                  <span className="module-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="module-mark">{module.mark}</span>
                  <div className="module-entry-copy">
                    <h3><Link className="module-title-link" href={module.path}>{t(module.title)}</Link></h3>
                    <p>{t(module.description)}</p>
                  </div>
                  <Link href={module.path} className="module-open-link" aria-label={`Open ${module.title}`}>
                    <span>{t('Open module')}</span><ArrowUpRight size={16} aria-hidden="true" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
        <DataSources />
      </main>
    </div>
  );
}

export function ModuleComingSoon({ module }: { module: ModuleInfo }) {
  return (
    <div className="terminal module-app">
      <ProductHeader module={module} />
      <main className="module-main module-coming-main">
        <nav className="module-breadcrumb" aria-label="Breadcrumb"><Link href="/">Crypto Order Flow</Link><span aria-hidden="true">/</span><span>{module.title}</span></nav>
        <div className="coming-card">
          <div className="coming-mark">{module.mark}</div>
          <span className="eyebrow">MODULE {module.mark} / PLANNED</span>
          <h1 className="module-page-title">{module.title}</h1>
          <p>{module.description}</p>
          <div className="coming-status"><Clock3 size={15} aria-hidden="true" /><span>This module is not available yet.</span></div>
          <div className="coming-home"><HomeButton /></div>
        </div>
      </main>
    </div>
  );
}

