import { Link } from 'wouter';
import '@/styles/site-footer.css';

/** Site footer: about, legal pages and a short risk notice. */
export function SiteFooter() {
  return (
    <footer className="site-footer" data-testid="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <span className="site-footer-mark" aria-hidden="true">CO</span>
          <div>
            <strong>Crypto Order Flow</strong>
            <p>Order-flow analytics for crypto perpetual markets.</p>
          </div>
        </div>
        <nav className="site-footer-col" aria-label="About">
          <h2>About</h2>
          <Link href="/about">About Us</Link>
        </nav>
        <nav className="site-footer-col" aria-label="Legal">
          <h2>Legal</h2>
          <Link href="/disclaimer">Disclaimer</Link>
          <Link href="/terms">Terms of Use</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/cookies">Cookie Preferences</Link>
        </nav>
      </div>
      <p className="site-footer-note">
        Crypto Order Flow is an analytics and educational tool. Nothing on this site is financial advice. Crypto and
        leveraged trading are high risk; do your own research. © {new Date().getFullYear()} Crypto Order Flow.
      </p>
    </footer>
  );
}
