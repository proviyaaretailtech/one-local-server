// The first time someone opens the app and reaches Home (after the intro, the language choice and the place), offer
// sign-in / sign-up once (founder, 2026-10-31). Never again on this phone, whatever they choose: the flag is saved
// before the screen opens, and a customer who is already signed in is never asked. Browsing never needs an account,
// so the sign-in screen opens in its welcome mode with "Skip for now".
import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname, useRouter } from 'expo-router';
import { useAuth } from '../auth';
import { useShowFirstRun } from '../i18n';

const PROMPTED_KEY = 'onelocal.signin.prompted';
const introShowing = () => !!(globalThis as { __onecityIntroShowing?: boolean }).__onecityIntroShowing;

export function SignInPrompt() {
  const path = usePathname(); const router = useRouter();
  const { session, ready } = useAuth();
  const firstRun = useShowFirstRun();
  const settled = useRef(false);

  useEffect(() => {
    if (settled.current || !ready || firstRun || path !== '/') return;
    if (session) { settled.current = true; AsyncStorage.setItem(PROMPTED_KEY, '1').catch(() => {}); return; }
    let live = true;
    // Wait for the intro to leave, then ask once.
    const id = setInterval(() => {
      if (introShowing()) return;
      clearInterval(id);
      AsyncStorage.getItem(PROMPTED_KEY).then(asked => {
        if (!live || settled.current) return;
        settled.current = true;
        if (asked) return;
        AsyncStorage.setItem(PROMPTED_KEY, '1').catch(() => {});
        router.push('/sign-in?welcome=1' as never);
      }).catch(() => {});
    }, 250);
    return () => { live = false; clearInterval(id); };
  }, [ready, firstRun, path, session, router]);
  return null;
}
