import { Link, useLocation } from 'wouter';
import { LogOut, UserRound } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import '@/styles/auth.css';

const currentPath = () => `${window.location.pathname}${window.location.search}`;

/** Header control: "Sign in" or the account with a sign-out action. */
export function AccountButton() {
  const { user, loading, signOut } = useAuth();
  const [, navigate] = useLocation();
  if (loading) return <span className="account-button placeholder" aria-hidden="true" />;
  if (!user) {
    return <Link href={`/signin?next=${encodeURIComponent(currentPath())}`} className="account-button" data-testid="link-signin">
      <UserRound size={14} aria-hidden="true" /><span>Sign in</span></Link>;
  }
  return (
    <details className="account-menu">
      <summary className="account-button signed-in" aria-label={`Account: ${user.email}`} data-testid="button-account">
        <span className="account-initial" aria-hidden="true">{user.email[0]?.toUpperCase()}</span>
        <span className="account-email">{user.email}</span>
      </summary>
      <div className="account-menu-panel">
        <span className="account-menu-label">Signed in as</span>
        <strong>{user.email}</strong>
        <button type="button" onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/') })} data-testid="button-signout">
          <LogOut size={14} aria-hidden="true" /> Sign out
        </button>
      </div>
    </details>
  );
}

