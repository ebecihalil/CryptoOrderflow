import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { Star, X } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { onSignInRequest, safeNext, useAuth } from '@/hooks/use-auth';
import '@/styles/auth.css';

const currentPath = () => `${window.location.pathname}${window.location.search}`;

/** Rendered once: shows "Create a free account" when a signed-out user uses the watchlist. */
export function AuthPromptHost() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
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
        <h2 id="auth-prompt-title">Create a free account to use your watchlist</h2>
        <p>Save coins with ☆ and filter every section to just your watchlist. Your list follows you on any device once you sign in.</p>
        <div className="auth-prompt-actions">
          <Link href={`/signup?next=${next}`} className="auth-primary" onClick={() => setOpen(false)} data-testid="link-prompt-signup">Sign up free</Link>
          <Link href={`/signin?next=${next}`} className="auth-secondary" onClick={() => setOpen(false)} data-testid="link-prompt-signin">I have an account</Link>
        </div>
      </div>
    </div>
  );
}

export function AuthPage({ mode }: { mode: 'signup' | 'signin' }) {
  const { user, signUp, signIn } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const next = safeNext(new URLSearchParams(search).get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const mutation = mode === 'signup' ? signUp : signIn;
  const isSignup = mode === 'signup';

  useEffect(() => { if (user) navigate(next, { replace: true }); }, [user, next, navigate]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate({ email, password }, { onSuccess: () => navigate(next, { replace: true }) });
  };
  const other = `${isSignup ? '/signin' : '/signup'}?next=${encodeURIComponent(next)}`;

  return (
    <div className="terminal module-app">
      <AppHeader title="Crypto Order Flow" mark="CO" sectionLabel={isSignup ? 'Sign up' : 'Sign in'} subtitle="Market Toolkit" />
      <main className="auth-main">
        <form className="auth-card" onSubmit={submit} noValidate data-testid={`form-${mode}`}>
          <span className="eyebrow">{isSignup ? 'FREE ACCOUNT' : 'WELCOME BACK'}</span>
          <h1>{isSignup ? 'Create your account' : 'Sign in'}</h1>
          <p className="auth-lede">{isSignup ? 'Unlock your personal watchlist across every section. Free, no card needed.' : 'Sign in to use your watchlist.'}</p>
          <label><span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}
              required maxLength={254} data-testid="input-email" />
          </label>
          <label><span>Password</span>
            <input type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} value={password}
              onChange={(event) => setPassword(event.target.value)} required minLength={isSignup ? 8 : undefined} maxLength={128}
              data-testid="input-password" />
            {isSignup && <small>At least 8 characters.</small>}
          </label>
          {mutation.error && <div className="auth-error" role="alert" data-testid="text-auth-error">{mutation.error.message}</div>}
          <button type="submit" className="auth-primary" disabled={mutation.isPending} data-testid="button-auth-submit">
            {mutation.isPending ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
          </button>
          <p className="auth-switch">{isSignup ? 'Already have an account?' : 'New here?'} <Link href={other}>{isSignup ? 'Sign in' : 'Create a free account'}</Link></p>
          <p className="auth-note">There is no email verification or password reset yet, so keep your password safe.</p>
        </form>
      </main>
    </div>
  );
}
