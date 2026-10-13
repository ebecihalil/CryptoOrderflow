import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('LSAR, Funding and all other module pages use the shared Home button', () => {
  for (const path of ['src/App.tsx', 'src/components/funding-page.tsx', 'src/components/module-pages.tsx']) {
    const source = read(path);
    assert.match(source, /import \{ AppHeader \} from '@\/components\/app-header'/);
    assert.match(source, /<AppHeader /);
    assert.doesNotMatch(source, /(?:lsar-home-link|module-home-link|coming-back)/);
  }
  assert.match(read('src/components/app-header.tsx'), /<HomeButton \/>/);
});

test('shared Home navigation has an accessible label, arrow and root destination', () => {
  const source = read('src/components/home-button.tsx');
  assert.match(source, /href="\/"/);
  assert.match(source, /aria-label="Back to Crypto Order Flow home"/);
  assert.match(source, /<ArrowLeft size=\{15\} aria-hidden="true" \/>/);
  assert.match(source, /<span>Home<\/span>/);
});

test('Home styling stays consistent across pages, themes and viewport widths', () => {
  const css = read('src/styles/home-button.css');
  assert.match(css, /height:36px/);
  assert.match(css, /var\(--lsar-surface\)/);
  assert.match(css, /var\(--lsar-strong\)/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /display:none|font-size:0/);
  for (const path of ['src/styles/modules.css', 'src/styles/funding.css']) {
    assert.doesNotMatch(read(path), /(?:lsar-home-link|module-home-link|coming-back)/);
  }
});
