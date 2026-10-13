import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, ChevronDown, Clock3 } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { HomeButton } from '@/components/home-button';
import { MODULES, RATIO_SECTIONS, type ModuleInfo } from '@/lib/modules';

function ProductHeader({ module }: { module?: ModuleInfo }) {
  return (
    <AppHeader title={module?.title ?? 'Crypto Order Flow'} mark={module?.mark ?? 'CO'}
      sectionLabel={module?.title ?? 'Overview'} subtitle={module ? 'Perpetual Markets' : 'Market Toolkit'} />
  );
}

export function ModuleHome() {
  const [ratioOpen, setRatioOpen] = useState(false);
  return (
    <div className="terminal module-app">
      <ProductHeader />
      <main className="module-main module-home-main">
        <div className="module-kicker module-home-kicker"><span className="module-kicker-rule" /> MARKET MECHANICS</div>
        <h1 className="module-page-title module-home-title">Crypto Order Flow</h1>
        <p className="module-home-intro module-home-lede">A clear read on positioning, participation, and pressure across perpetual markets.</p>

        <section className="module-directory" aria-label="Market modules">
          <div className="directory-heading">
            <div><span className="eyebrow">01 / MODULE DIRECTORY</span><h2>Choose a market lens</h2></div>
            <span className="directory-count">06 MODULES</span>
          </div>
          <div className="module-list">
            {MODULES.map((module, index) => {
              const isRatio = module.title === 'Long Short Ratio';
              return (
                <article key={module.path} className={`module-entry ${isRatio ? 'module-entry-ratio' : ''} ${ratioOpen && isRatio ? 'is-open' : ''}`}>
                  <div className="module-entry-row">
                    <span className="module-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="module-mark">{module.mark}</span>
                    <div className="module-entry-copy">
                      <h3>{isRatio ? (
                        <button className="module-title-button" type="button" aria-expanded={ratioOpen}
                          aria-controls="ratio-options" onClick={() => setRatioOpen(open => !open)}>
                          {module.title}
                        </button>
                      ) : <Link className="module-title-link" href={module.path}>{module.title}</Link>}</h3>
                      <p>{module.description}</p>
                    </div>
                    {isRatio ? (
                      <button type="button" className="module-expand" aria-label={`${ratioOpen ? 'Collapse' : 'Expand'} Long Short Ratio`} aria-expanded={ratioOpen} aria-controls="ratio-options" onClick={() => setRatioOpen((open) => !open)}>
                        <span>{ratioOpen ? 'Close' : 'Explore'}</span><ChevronDown size={16} aria-hidden="true" />
                      </button>
                    ) : (
                      <Link href={module.path} className="module-open-link" aria-label={`Open ${module.title}`}>
                        <span>Open module</span><ArrowUpRight size={16} aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                  {isRatio && ratioOpen && (
                    <div className="ratio-options" id="ratio-options" role="group" aria-label="Long Short Ratio sections">
                      {RATIO_SECTIONS.map(section => (
                        <Link key={section.path} href={section.path} className="ratio-option">
                          <span className="ratio-option-mark">{section.mark}</span>
                          <span><strong>{section.title}</strong><small>{section.description}</small></span>
                          <ArrowUpRight size={15} aria-hidden="true" />
                        </Link>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
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

