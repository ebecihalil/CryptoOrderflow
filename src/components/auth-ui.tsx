import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from 'wouter';
import { Star, X } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { onSignInRequest, safeNext, useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/lib/i18n';
import '@/styles/auth.css';

const currentPath = () => `${window.location.pathname}${window.location.search}`;

/** Rendered once: shows "Create a free account" when a signed-out user uses the watchlist. */
export function AuthPromptHost() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useEffect(() => onSignInRequest(() => setOpen(true)), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    dialog.current?.querySelector<HTMLElement>('a, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const next = encodeURIComponent(currentPath());
  return (
    <div className="auth-backdrop" onClick={() => setOpen(false)}>
      <div className="auth-prompt" role="dialog" aria-modal="true" aria-labelledby="auth-prompt-title" ref={dialog}
        onClick={(event) => event.stopPropagation()} data-testid="dialog-auth-prompt">
        <button type="button" className="auth-close" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
        <span className="auth-prompt-icon" aria-hidden="true"><Star size={20} fill="currentColor" /></span>
        <h2 id="auth-prompt-title">{t('Create a free account to use your watchlist')}</h2>
        <p>{t('Save coins with ☆ and filter every section to just your watchlist. Your list follows you on any device once you sign in.')}</p>
        <div className="auth-prompt-actions">
          <Link href={`/signup?next=${next}`} className="auth-primary" onClick={() => setOpen(false)} data-testid="link-prompt-signup">{t('Sign up free')}</Link>
          <Link href={`/signin?next=${next}`} className="auth-secondary" onClick={() => setOpen(false)} data-testid="link-prompt-signin">{t('I have an account')}</Link>
        </div>
      </div>
    </div>
  );
}

/** Sign in / sign up form. `next` is where to go after success. */
export function AuthForm({ mode, next, lede }: { mode: 'signup' | 'signin'; next: string; lede?: string }) {
  const { signUp, signIn } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const mutation = mode === 'signup' ? signUp : signIn;
  const isSignup = mode === 'signup';
  const { t, lang } = useI18n();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate({ email, password }, { onSuccess: () => navigate(next, { replace: true }) });
  };
  const other = `${isSignup ? '/signin' : '/signup'}?next=${encodeURIComponent(next)}`;
  const providers = useQuery({ queryKey: ['auth-providers'], staleTime: Infinity, retry: 0,
    queryFn: async () => (await (await fetch('/api/auth/providers')).json()) as { google: boolean } });
  const googleError = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('error') : null;

  return (
    <form className="auth-card" onSubmit={submit} noValidate data-testid={`form-${mode}`}>
      {lang === 'en' && <span className="eyebrow">{isSignup ? 'FREE ACCOUNT' : 'WELCOME BACK'}</span>}
      <h1>{t(isSignup ? 'Create your account' : 'Sign in')}</h1>
      <p className="auth-lede">{lede ?? t(isSignup ? 'Unlock your personal watchlist across every section. Free, no card needed.' : 'Sign in to use your watchlist.')}</p>
      <label><span>{t('Email')}</span>
        <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}
          required maxLength={254} data-testid="input-email" />
      </label>
      <label><span>{t('Password')}</span>
        <input type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} value={password}
          onChange={(event) => setPassword(event.target.value)} required minLength={isSignup ? 8 : undefined} maxLength={128}
          data-testid="input-password" />
        {isSignup && <small>{t('At least 8 characters.')}</small>}
      </label>
      {providers.data?.google && <>
        <a className="auth-google" href={`/api/auth/google/start?next=${encodeURIComponent(next)}`} data-testid="link-google">
          <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6C12.3 13.6 17.6 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/>
            <path fill="#FBBC05" d="M10.5 28.8c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6C1 16.5 0 20.1 0 24s1 7.5 2.7 10.8l7.8-6z"/>
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.4 0-11.7-4.1-13.5-9.7l-7.8 6C6.6 42.6 14.6 48 24 48z"/>
          </svg>
          {isSignup ? 'Sign up with Google' : 'Sign in with Google'}
        </a>
        <div className="auth-divider"><span>or with email</span></div>
      </>}
      {googleError && <div className="auth-error" role="alert">{googleError}</div>}
      {mutation.error && <div className="auth-error" role="alert" data-testid="text-auth-error">{mutation.error.message}</div>}
      <button type="submit" className="auth-primary" disabled={mutation.isPending} data-testid="button-auth-submit">
        {mutation.isPending ? '…' : t(isSignup ? 'Create account' : 'Sign in')}
      </button>
      <p className="auth-switch">{t(isSignup ? 'Already have an account?' : 'New here?')} <Link href={other}>{t(isSignup ? 'Sign in' : 'Create a free account')}</Link></p>
      <p className="auth-note">There is no email verification or password reset yet, so keep your password safe.</p>
    </form>
  );
}

export function AuthPage({ mode }: { mode: 'signup' | 'signin' }) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const next = safeNext(new URLSearchParams(search).get('next'));
  useEffect(() => { if (user) navigate(next, { replace: true }); }, [user, next, navigate]);
  return (
    <div className="terminal module-app">
      <AppHeader title="Crypto Order Flow" mark="CO" sectionLabel={mode === 'signup' ? 'Sign up' : 'Sign in'} subtitle="Market Toolkit" />
      <main className="auth-main">
        <AuthForm mode={mode} next={next} />
      </main>
    </div>
  );
}
