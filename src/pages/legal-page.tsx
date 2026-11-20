import { Link } from 'wouter';
import { AppHeader } from '@/components/app-header';
import '@/styles/legal.css';

const UPDATED = '20 November 2026';

function Privacy() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>
      <p>Crypto Order Flow shows crypto market data (prices, order flow and derivatives indicators) collected from public exchange APIs. This page explains what we store about you.</p>
      <h2>What we store</h2>
      <ul>
        <li><strong>Account:</strong> your email address and, if you sign up with a password, a salted one-way hash of it (never the password itself).</li>
        <li><strong>Sign in with Google:</strong> we only ask Google for your email address and whether it is verified. We do not get your contacts, files, name or any other Google data, and we do not store Google tokens.</li>
        <li><strong>Your settings:</strong> your watchlist, recent coins, chart layouts, indicators and indicator settings, so they follow you across devices.</li>
        <li><strong>Session cookie:</strong> one cookie that keeps you signed in. It is not used for tracking or advertising.</li>
        <li><strong>Your browser:</strong> some settings (e.g. theme, language, chart view) are kept in your browser's local storage.</li>
      </ul>
      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell, rent or share your data with anyone.</li>
        <li>We do not use advertising or third-party tracking.</li>
        <li>We do not send you marketing emails.</li>
      </ul>
      <h2>Where it is kept</h2>
      <p>On our own server. Requests are served over HTTPS. Market data requests to exchanges are made by our server and do not include your data.</p>
      <h2>Deleting your data</h2>
      <p>You can ask for your account and all its settings to be deleted at any time; they are then removed from our database. Signing out removes the session cookie from your browser.</p>
      <h2>Changes</h2>
      <p>If this policy changes, the date at the top changes too.</p>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>
      <p>By using Crypto Order Flow you agree to these terms.</p>
      <h2>Information only</h2>
      <p>Everything on this site (charts, indicators, estimates and data) is for information only and is not financial, investment or trading advice. Crypto trading is risky; you are responsible for your own decisions.</p>
      <h2>No guarantee</h2>
      <p>Data comes from third-party exchanges and can be delayed, incomplete or wrong. The site is provided “as is”, without any warranty, and may change or be unavailable at any time.</p>
      <h2>Your account</h2>
      <p>Keep your sign-in details safe. Do not misuse the site, overload it, or try to access other people's accounts. We may suspend accounts that do.</p>
      <h2>Liability</h2>
      <p>We are not liable for any losses arising from use of the site or its data.</p>
      <p>See also the <Link href="/privacy">Privacy Policy</Link>.</p>
    </>
  );
}

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  return (
    <div className="terminal module-app">
      <AppHeader title="Crypto Order Flow" mark="CO" sectionLabel={kind === 'privacy' ? 'Privacy' : 'Terms'} subtitle="Market Toolkit" />
      <main className="legal-main">{kind === 'privacy' ? <Privacy /> : <Terms />}</main>
    </div>
  );
}
