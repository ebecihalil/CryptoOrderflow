import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AppHeader } from '@/components/app-header';
import { useAuth } from '@/hooks/use-auth';
import { SiteFooter } from '@/components/site-footer';
import '@/styles/legal.css';

const UPDATED = '20 November 2026';
export type LegalKind = 'about' | 'contact' | 'disclaimer' | 'terms' | 'privacy' | 'cookies';
const TITLES: Record<LegalKind, string> = {
  about: 'About Us', contact: 'Contact Us', disclaimer: 'Disclaimer', terms: 'Terms of Use', privacy: 'Privacy Policy', cookies: 'Cookie Preferences',
};

function About() {
  return (
    <>
      <h1>About Us</h1>
      <p className="legal-lede">Crypto Order Flow is a trading platform that turns raw exchange data into clear views of what traders are actually doing — who is buying, who is selling, who is leveraged and where positions are being opened or closed.</p>
      <h2>The founder</h2>
      <p>After completing my engineering education in Turkey, I pursued an MBA in Business at the University of Wales and lived in London for 16 years. I built and sold my own e-commerce brand, which gave me financial freedom. Today I am a full-time trader, focused on simplifying statistical data and backtesting it to build clear technical strategies.</p>
      <h2>Why order flow</h2>
      <p>My approach is not to run mathematical formulas over price candles. Price candles are the result; I look for the reason behind them. Every single candle has a story: aggressive buyers and sellers, positions being opened or closed, leveraged traders being liquidated, funding pushing one side out. Order flow shows that story.</p>
      <p>Instead of making unrealistic assumptions from the shape of past candles, I want to understand what really happened inside each candle and use that to judge what is most likely to happen next. That is why this site focuses on order-flow data — CVD, open interest, liquidations, funding, long/short positioning and leverage — collected from as many exchanges as possible and shown in a way that is easy to read.</p>
      <h2>What we aim for</h2>
      <p>I want to share this way of reading the market and help build a well-informed audience: traders who understand the mechanics behind price, make decisions with more context and manage their risk with their eyes open.</p>
      <p className="legal-callout">Crypto Order Flow is a trading platform for charts and order-flow analysis, built for information and education. Nothing on it is financial advice. Please read the <Link href="/disclaimer">Disclaimer</Link>.</p>
    </>
  );
}

function Disclaimer() {
  return (
    <>
      <h1>Disclaimer</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>
      <p className="legal-callout">Crypto Order Flow is a trading platform for market data, charts and analysis, built for information and education. Nothing on this website is financial, investment, trading, legal or tax advice, and nothing on it is a recommendation or an offer to buy, sell or hold any asset.</p>
      <h2>Information and education only</h2>
      <p>All charts, indicators, estimates, rankings, signals, descriptions and other content are provided for general information and educational purposes. They describe what market data shows; they do not tell you what to do. Any explanation of how traders "usually" read an indicator is educational, not a trading instruction.</p>
      <h2>No personal recommendation</h2>
      <p>The content does not take into account your objectives, financial situation, experience or needs. We are not a registered investment adviser, broker, dealer or financial institution, and using this site does not create any advisory, fiduciary or client relationship. Before making any financial decision, do your own research and consider speaking with a qualified, independent professional.</p>
      <h2>High risk</h2>
      <p>Cryptocurrencies and crypto derivatives (including perpetual futures and leveraged products) are highly volatile and speculative. You can lose some or all of your money, and with leverage you can lose it very quickly. Only trade with money you can afford to lose.</p>
      <h2>Data accuracy</h2>
      <p>Data comes from third-party exchanges and public APIs and is processed automatically. It may be delayed, incomplete, sampled, estimated or wrong, and exchanges may change or stop their data at any time. Some indicators (for example leverage estimates) are models built from incomplete data and are estimates, not facts. We do not guarantee the accuracy, completeness, timeliness or availability of any information.</p>
      <h2>No guarantee of results</h2>
      <p>Past performance, historical data and backtests do not guarantee future results. No indicator, model or strategy can predict the market reliably.</p>
      <h2>Your responsibility</h2>
      <p>You alone are responsible for your trading and investment decisions and their results. To the fullest extent permitted by law, Crypto Order Flow and its operator accept no liability for any loss or damage arising from the use of, or reliance on, this website or its content.</p>
      <h2>Third parties and local laws</h2>
      <p>Exchange names and logos identify data sources only and do not imply endorsement or partnership. Crypto trading may be restricted in some countries; it is your responsibility to follow the laws that apply to you.</p>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1>Terms of Use</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>
      <p>These terms apply to your use of Crypto Order Flow (the "site"). By using the site or creating an account you agree to them. If you do not agree, please do not use the site.</p>
      <h2>1. The service</h2>
      <p>Crypto Order Flow is a trading platform for crypto market data, charts and analytical indicators, provided for information and education. Trading itself happens on the exchanges you choose: the site does not execute orders, is not an exchange, broker or wallet, does not give investment advice and never holds or moves your funds. The <Link href="/disclaimer">Disclaimer</Link> forms part of these terms.</p>
      <h2>2. Eligibility</h2>
      <p>You must be at least 18 years old and allowed to use services like this where you live.</p>
      <h2>3. Your account</h2>
      <p>You are responsible for keeping your sign-in details safe and for activity on your account. Give accurate information and tell us if you think your account has been misused. You can stop using your account at any time.</p>
      <h2>4. Acceptable use</h2>
      <p>Do not misuse the site. In particular, do not: scrape or bulk-download data or resell it; overload, probe or attack the site or its infrastructure; try to access other people's accounts or non-public areas; use automated tools to create accounts or bypass limits; or use the site for anything unlawful. We may limit, suspend or close access that breaks these rules.</p>
      <h2>5. Intellectual property</h2>
      <p>The site's design, code, indicator calculations, texts and graphics belong to Crypto Order Flow or its licensors. You may use the site for your own personal analysis and may share screenshots with credit to Crypto Order Flow. Market data remains subject to the terms of the exchanges that publish it.</p>
      <h2>6. Availability and changes</h2>
      <p>The site is provided "as is" and "as available". Features, indicators and data sources may change, pause or be removed at any time, and the site may be unavailable or contain errors.</p>
      <h2>7. No warranties</h2>
      <p>To the fullest extent permitted by law, we make no warranties of any kind — including accuracy, reliability, fitness for a particular purpose or non-infringement — about the site or its data.</p>
      <h2>8. Limitation of liability</h2>
      <p>To the fullest extent permitted by law, Crypto Order Flow and its operator are not liable for any trading or investment losses, lost profits, lost data, or any indirect or consequential damages arising from your use of, or inability to use, the site. Nothing in these terms limits liability that cannot be limited by law.</p>
      <h2>9. Indemnity</h2>
      <p>If you break these terms or the law while using the site, you agree to cover the reasonable costs and claims that result from it.</p>
      <h2>10. Changes to these terms</h2>
      <p>We may update these terms. The date at the top shows the latest version; continuing to use the site after a change means you accept it.</p>
      <p>See also the <Link href="/privacy">Privacy Policy</Link> and <Link href="/cookies">Cookie Preferences</Link>.</p>
    </>
  );
}

function Privacy() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>
      <p>We collect as little as possible. This page explains what we store, why, and your choices.</p>
      <h2>What we store</h2>
      <ul>
        <li><strong>Account:</strong> your email address and, if you sign up with a password, a salted one-way hash of it (never the password itself).</li>
        <li><strong>Sign in with Google:</strong> we only receive your email address and whether Google has verified it. We do not get your contacts, files, name or other Google data, and we do not keep Google tokens.</li>
        <li><strong>Your settings:</strong> watchlist, recent coins, chart layouts, indicators and indicator settings, so they follow you across devices.</li>
        <li><strong>Session cookie:</strong> one cookie that keeps you signed in (see <Link href="/cookies">Cookie Preferences</Link>).</li>
        <li><strong>Contact messages:</strong> if you use the Contact Us form, your name, email address and message, used only to answer you.</li>
        <li><strong>Technical logs:</strong> our server may briefly log technical information such as IP address and request errors to keep the site secure and working.</li>
      </ul>
      <h2>Why we use it</h2>
      <p>Only to provide the site: to sign you in, save your settings, keep the service secure and fix problems. The legal basis is providing the service you asked for and our legitimate interest in running it securely.</p>
      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell, rent or share your personal data for marketing.</li>
        <li>We do not use advertising or third-party tracking or analytics cookies.</li>
        <li>We do not send marketing emails.</li>
      </ul>
      <h2>Where it is kept and for how long</h2>
      <p>Data is kept on our own server and served over HTTPS. Account data is kept while your account exists; technical logs are kept only for a short period. Market data requests to exchanges are made by our server and never include your personal data.</p>
      <h2>Your rights</h2>
      <p>You can ask to see, correct, export or delete your account data at any time; deleting your account removes your email and saved settings from our database. Depending on where you live (for example under the UK GDPR or EU GDPR) you may also have the right to object or complain to your data-protection authority.</p>
      <h2>Children</h2>
      <p>The site is not intended for anyone under 18.</p>
      <h2>Changes</h2>
      <p>If this policy changes, the date at the top changes too.</p>
    </>
  );
}

const SETTING_PREFIXES = ['cof:', 'crypto-orderflow:'];
function Cookies() {
  const [cleared, setCleared] = useState<number | null>(null);
  const clear = () => {
    let count = 0;
    try {
      for (const key of Object.keys(localStorage)) {
        if (SETTING_PREFIXES.some((prefix) => key.startsWith(prefix))) { localStorage.removeItem(key); count++; }
      }
    } catch { /* storage blocked */ }
    setCleared(count);
  };
  return (
    <>
      <h1>Cookie Preferences</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>
      <p>We keep this simple: the site uses no advertising, tracking or analytics cookies, so there is nothing to opt out of. Only what is needed for the site to work is used.</p>
      <div className="cookie-table" role="table" aria-label="Cookie categories">
        <div className="cookie-row" role="row">
          <div role="cell"><strong>Strictly necessary</strong><p>One session cookie that keeps you signed in, plus a short-lived security cookie during Google sign-in. Without them you cannot sign in.</p></div>
          <span className="cookie-state is-on" role="cell">Always on</span>
        </div>
        <div className="cookie-row" role="row">
          <div role="cell"><strong>Preferences (stored in your browser)</strong><p>Your theme, language, chart view and settings are saved in your browser's local storage so the site remembers them. They are not sent to anyone else.</p></div>
          <span className="cookie-state is-on" role="cell">On</span>
        </div>
        <div className="cookie-row" role="row">
          <div role="cell"><strong>Analytics</strong><p>Not used.</p></div>
          <span className="cookie-state" role="cell">Not used</span>
        </div>
        <div className="cookie-row" role="row">
          <div role="cell"><strong>Advertising / marketing</strong><p>Not used.</p></div>
          <span className="cookie-state" role="cell">Not used</span>
        </div>
      </div>
      <h2>Manage your data on this device</h2>
      <p>You can remove the chart settings and preferences saved in this browser. If you are signed in, your account settings stay saved on your account. You can also delete cookies at any time in your browser settings; signing out removes the session cookie.</p>
      <button type="button" className="legal-button" onClick={clear}>Clear saved settings on this device</button>
      {cleared !== null && <p className="legal-updated" role="status">Removed {cleared} saved item{cleared === 1 ? '' : 's'} from this browser.</p>}
    </>
  );
}

const TOPICS = ['General question', 'Feedback / feature idea', 'Bug report', 'Account', 'Partnership', 'Other'];
function Contact() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', topic: TOPICS[0], message: '', website: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const email = form.email || user?.email || '';
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    setStatus('sending'); setError(null);
    try {
      const response = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, email }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Your message could not be sent.');
      setStatus('sent');
    } catch (failure) {
      setStatus('idle'); setError(failure instanceof Error ? failure.message : 'Your message could not be sent.');
    }
  };
  if (status === 'sent') return (
    <>
      <h1>Contact Us</h1>
      <p className="legal-callout" role="status">Thank you — your message has been sent. We will reply to <strong>{email}</strong> as soon as we can.</p>
      <button type="button" className="legal-button" onClick={() => { setForm((current) => ({ ...current, message: '' })); setStatus('idle'); }}>Send another message</button>
    </>
  );
  return (
    <>
      <h1>Contact Us</h1>
      <p>Questions, feedback, a bug or an idea for a new indicator? Send us a message and we will reply to the email address you give.</p>
      <form className="contact-form" onSubmit={submit} data-testid="contact-form">
        <label>Name<input required maxLength={80} value={form.name} onChange={set('name')} autoComplete="name" /></label>
        <label>Your email (we reply here)<input required type="email" maxLength={254} value={email} onChange={set('email')} autoComplete="email" /></label>
        <label>Topic<select value={form.topic} onChange={set('topic')}>{TOPICS.map((topic) => <option key={topic}>{topic}</option>)}</select></label>
        <label>Message<textarea required minLength={10} maxLength={5000} rows={7} value={form.message} onChange={set('message')} /></label>
        {/* Hidden from people; bots fill it in. */}
        <input className="contact-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={set('website')} name="website" />
        {error && <p className="contact-error" role="alert">{error}</p>}
        <button type="submit" className="legal-button contact-send" disabled={status === 'sending'}>{status === 'sending' ? 'Sending…' : 'Send message'}</button>
        <p className="legal-updated">Your email is used only to answer you (see the <Link href="/privacy">Privacy Policy</Link>). We never ask for passwords, private keys or seed phrases.</p>
      </form>
    </>
  );
}

export function LegalPage({ kind }: { kind: LegalKind }) {
  useEffect(() => { window.scrollTo(0, 0); }, [kind]);
  const Body = { about: About, contact: Contact, disclaimer: Disclaimer, terms: Terms, privacy: Privacy, cookies: Cookies }[kind];
  return (
    <div className="terminal module-app">
      <AppHeader title="Crypto Order Flow" mark="CO" sectionLabel={TITLES[kind]} subtitle="Market Toolkit" />
      <main className="legal-main"><Body /></main>
      <SiteFooter />
    </div>
  );
}
