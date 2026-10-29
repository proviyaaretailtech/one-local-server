// A signed-in customer with no name yet (a new mobile-code account, or any first sign-in that gave none) is taken to the
// one-time "One last step" screen (app/welcome.tsx). Browsing never needs an account, so this only runs once signed in.
// It waits for the profile and the account to load, and never interrupts the screens a customer must always reach.
import { useEffect } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { useAuth } from '../auth';
import { useCustomer } from '../customer';

const FREE = ['/welcome', '/profile-edit', '/sign-in', '/location', '/address', '/privacy', '/language', '/about', '/help'];

export function ProfileGate() {
  const path = usePathname(); const router = useRouter();
  const { session, ready: authReady } = useAuth(); const { profile, ready: profileReady } = useCustomer();
  const meta = session?.user.user_metadata ?? {};
  // A name known from the account (Google, or entered on another phone) is filled into the profile by the auth provider; do not ask for it again.
  const known = !!(profile.name.trim() || String(meta.full_name ?? meta.name ?? '').trim());
  useEffect(() => {
    if (!authReady || !profileReady || !session || known) return;
    if (FREE.some(p => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}-`))) return;
    router.replace((path === '/' ? '/welcome' : `/welcome?next=${encodeURIComponent(path)}`) as never);
  }, [authReady, profileReady, session, known, path, router]);
  return null;
}
